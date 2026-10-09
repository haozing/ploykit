package redisx

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

func New(ctx context.Context, url string) (redis.UniversalClient, bool) {
	if url == "" {
		return nil, false
	}
	opt, err := ParseUniversalOptions(url)
	if err != nil {
		return nil, false
	}
	cli := redis.NewUniversalClient(opt)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := cli.Ping(pingCtx).Err(); err != nil {
		_ = cli.Close()
		return nil, false
	}
	return cli, true
}

func ParseUniversalOptions(raw string) (*redis.UniversalOptions, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("redisx: empty REDIS_URL")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	switch u.Scheme {
	case "redis", "rediss":

		o, err := redis.ParseURL(raw)
		if err != nil {
			return nil, err
		}
		return &redis.UniversalOptions{
			Addrs:     []string{o.Addr},
			DB:        o.DB,
			Username:  o.Username,
			Password:  o.Password,
			TLSConfig: o.TLSConfig,
		}, nil
	case "unix":
		o, err := redis.ParseURL(raw)
		if err != nil {
			return nil, err
		}
		sock := o.Addr
		out := &redis.UniversalOptions{
			Addrs:    []string{sock},
			DB:       o.DB,
			Username: o.Username,
			Password: o.Password,
		}

		out.Dialer = func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		}
		return out, nil
	case "redis+cluster", "rediss+cluster", "redis+sentinel", "rediss+sentinel":
		addrs, err := splitHosts(u.Host)
		if err != nil {
			return nil, err
		}
		out := &redis.UniversalOptions{Addrs: addrs}
		if ui := u.User; ui != nil {
			out.Username = ui.Username()
			out.Password, _ = ui.Password()
		}
		if u.Scheme == "redis+sentinel" || u.Scheme == "rediss+sentinel" {

			if out.Username == "" {
				return nil, errors.New("redisx: sentinel URL requires master name in userinfo (redis+sentinel://master@host:26379)")
			}
			out.MasterName = out.Username
			out.Username = ""
		}
		if strings.HasPrefix(u.Scheme, "rediss") {

			out.TLSConfig = &tls.Config{}
		}
		return out, nil
	default:
		return nil, errors.New("redisx: invalid REDIS_URL scheme " + u.Scheme + " (want redis:// rediss:// unix:// redis+cluster:// rediss+cluster:// redis+sentinel:// rediss+sentinel://)")
	}
}

func splitHosts(host string) ([]string, error) {
	var out []string
	for _, h := range strings.Split(host, ",") {
		if h = strings.TrimSpace(h); h != "" {
			out = append(out, h)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("redisx: cluster/sentinel URL requires at least one host")
	}
	return out, nil
}
