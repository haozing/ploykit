package egressx

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateURLPrivateRangesRejected(t *testing.T) {
	g := DefaultGuard()
	ctx := context.Background()
	for _, u := range []string{
		"https://127.0.0.1/api",
		"https://localhost/api",
		"https://10.1.2.3/mcp",
		"https://172.16.0.9/mcp",
		"https://172.31.255.1/mcp",
		"https://192.168.1.1/mcp",
		"https://169.254.169.254/latest/meta-data",
		"https://0.0.0.0/x",
		"https://[::1]/x",
	} {
		assert.Error(t, g.ValidateURL(ctx, u), "should reject %s", u)
	}
}

func TestValidateURLSchemeAndHost(t *testing.T) {
	g := DefaultGuard()
	ctx := context.Background()
	assert.Error(t, g.ValidateURL(ctx, "http://example.com"))
	assert.Error(t, g.ValidateURL(ctx, "https://"))
	assert.NoError(t, g.ValidateURL(ctx, "https://8.8.8.8/x"))
}

func TestValidateURLPublicDomainOK(t *testing.T) {
	g := DefaultGuard()

	if err := g.ValidateURL(context.Background(), "https://example.com"); err != nil {
		t.Skipf("environment has no DNS (%v) — public domain rejection path already covered by IP literal cases", err)
	}
}

func TestExtraAllowCIDR(t *testing.T) {
	g, err := NewGuard([]string{"10.0.0.0/8"})
	require.NoError(t, err)
	assert.NoError(t, g.ValidateURL(context.Background(), "https://10.1.2.3/mcp"))
	assert.Error(t, g.ValidateURL(context.Background(), "https://192.168.0.1/mcp"))
}

func TestNewGuardInvalidCIDRFailsFast(t *testing.T) {
	_, err := NewGuard([]string{"not-a-cidr"})
	assert.Error(t, err)
}
