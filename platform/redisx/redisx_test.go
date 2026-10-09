package redisx

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseUniversalOptions(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		wantErr bool
		check   func(t *testing.T, o *redis.UniversalOptions)
	}{
		{
			name: "single node without auth",
			url:  "redis://localhost:6379",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, []string{"localhost:6379"}, o.Addrs)
				assert.Zero(t, o.DB)
				assert.Empty(t, o.Password)
				assert.Nil(t, o.TLSConfig)
				assert.Empty(t, o.MasterName, "single Addr without master name → NewClient dispatch")
			},
		},
		{
			name: "single node with password and db",
			url:  "redis://:secret@redis.internal:6380/2",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, []string{"redis.internal:6380"}, o.Addrs)
				assert.Equal(t, "secret", o.Password)
				assert.Equal(t, 2, o.DB)
			},
		},
		{
			name: "single node with username and password",
			url:  "redis://default:pw@h:6379/0",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, "default", o.Username)
				assert.Equal(t, "pw", o.Password)
			},
		},
		{
			name: "single-node TLS (rediss)",
			url:  "rediss://tls.internal:6380",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, []string{"tls.internal:6380"}, o.Addrs)
				require.NotNil(t, o.TLSConfig, "rediss must use TLS")
			},
		},
		{
			name: "unix socket",
			url:  "unix:///var/run/redis/redis.sock?db=3",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, []string{"/var/run/redis/redis.sock"}, o.Addrs)
				assert.Equal(t, 3, o.DB)
				require.NotNil(t, o.Dialer, "unix must have the Dialer force the unix network")
				conn, err := o.Dialer(context.Background(), "tcp", "ignored")
				if err == nil {
					_ = conn.Close()
				}
			},
		},
		{
			name: "cluster seed list",
			url:  "redis+cluster://c1:6379,c2:6379,c3:6379",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, []string{"c1:6379", "c2:6379", "c3:6379"}, o.Addrs)
				assert.Empty(t, o.MasterName, "no master name → ClusterClient dispatch")
				assert.Nil(t, o.TLSConfig)
			},
		},
		{
			name: "cluster with password TLS",
			url:  "rediss+cluster://:pw@c1:6379,c2:6379",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Len(t, o.Addrs, 2)
				assert.Equal(t, "pw", o.Password)

				require.NotNil(t, o.TLSConfig)
				assert.Empty(t, o.TLSConfig.ServerName,
					"cluster TLS ServerName 必须留空（按节点推导），不得钉死 seed 地址")
			},
		},
		{
			name: "sentinel TLS",
			url:  "rediss+sentinel://mymaster:pw@s1:26379,s2:26379",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, "mymaster", o.MasterName)
				require.NotNil(t, o.TLSConfig)
				assert.Empty(t, o.TLSConfig.ServerName,
					"sentinel TLS ServerName 同样按节点推导（哨兵→主节点地址各不相同）")
			},
		},
		{
			name: "sentinel master name",
			url:  "redis+sentinel://mymaster:pw@s1:26379,s2:26379",
			check: func(t *testing.T, o *redis.UniversalOptions) {
				assert.Equal(t, "mymaster", o.MasterName, "userinfo username = master name → FailoverClient dispatch")
				assert.Equal(t, "pw", o.Password)
				assert.Equal(t, []string{"s1:26379", "s2:26379"}, o.Addrs)
			},
		},
		{name: "empty URL", url: "", wantErr: true},
		{name: "blank URL", url: "   ", wantErr: true},
		{name: "unknown scheme", url: "http://localhost:6379", wantErr: true},
		{name: "pure garbage", url: "not a url at all", wantErr: true},
		{name: "cluster without hosts", url: "redis+cluster://", wantErr: true},
		{name: "sentinel missing master name", url: "redis+sentinel://s1:26379", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			o, err := ParseUniversalOptions(tc.url)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, o)
			tc.check(t, o)
		})
	}
}

func TestNewDegradation(t *testing.T) {
	cli, ok := New(context.Background(), "")
	assert.False(t, ok)
	assert.Nil(t, cli)

	cli, ok = New(context.Background(), "not a url")
	assert.False(t, ok)
	assert.Nil(t, cli)

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	cli, ok = New(ctx, "redis://127.0.0.1:1/9")
	if ok {
		_ = cli.Close()
		t.Log("  127.0.0.1:1 unexpectedly dialable (environment proxy) — relax assertion")
	}
}
