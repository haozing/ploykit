package oidcfed

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolve_PrivateIssuerDeniedByDefault_I16(t *testing.T) {
	idp := newFakeIdP(t)
	t.Setenv(EnvAllowPrivateIDP, "")
	r := NewResolver()
	_, err := r.Resolve(context.Background(), idp.srv.URL, "cid", "sec", "")
	require.Error(t, err, "私网（环回）issuer 默认必须被 egressx 拒绝（SSRF 面）")
	assert.Zero(t, idp.discoveryHits, "拒绝发生在出站预检/Dial 控制层，discovery 请求不得到达 IdP")
}

func TestResolve_PrivateIssuerAllowedViaEnv_I16(t *testing.T) {
	idp := newFakeIdP(t)
	t.Setenv(EnvAllowPrivateIDP, "1")
	r := NewResolver()
	_, err := r.Resolve(context.Background(), idp.srv.URL, "cid", "sec", "")
	require.NoError(t, err, "FED_ALLOW_PRIVATE_IDP=1 时环回 IdP（本地开发）必须可达")
	assert.Equal(t, 1, idp.discoveryHits)
}
