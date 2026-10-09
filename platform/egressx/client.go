package egressx

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"
)

const defaultHTTPTimeout = 30 * time.Second

type Opts struct {
	Timeout time.Duration

	AllowCIDRs []string

	DisableEnvProxy bool

	Resolver *net.Resolver
}

func NewHTTPClient(opts Opts) (*http.Client, error) {
	guard, err := newGuard(opts.AllowCIDRs, opts.Resolver)
	if err != nil {
		return nil, err
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultHTTPTimeout
	}
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   controlHook(guard),
	}
	if opts.Resolver != nil {
		dialer.Resolver = opts.Resolver
	}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	if !opts.DisableEnvProxy {
		transport.Proxy = http.ProxyFromEnvironment
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: &guardTransport{base: transport, guard: guard},
	}, nil
}

type guardTransport struct {
	base  http.RoundTripper
	guard *Guard
}

func (t *guardTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if err := t.guard.ValidateURL(req.Context(), req.URL.String()); err != nil {
		return nil, err
	}
	return t.base.RoundTrip(req)
}

func GuardOf(c *http.Client) *Guard {
	if c == nil {
		return nil
	}
	if t, ok := c.Transport.(*guardTransport); ok {
		return t.guard
	}
	return nil
}

func controlHook(guard *Guard) func(network, address string, _ syscall.RawConn) error {
	return func(network, address string, _ syscall.RawConn) error {
		if err := guard.checkDialAddress(address); err != nil {
			return fmt.Errorf("egress: dial %s %s rejected: %w", network, address, err)
		}
		return nil
	}
}

func (g *Guard) checkDialAddress(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("egress: dial address %q: %w", address, err)
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return fmt.Errorf("egress: dial address %q is not an IP literal: %w", address, err)
	}
	return g.checkIP(ip.Unmap(), host)
}
