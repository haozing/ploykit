package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// F12: NoopEmailSender satisfies the full four-method port as a no-op base —
// products only using code login embed it and override what they need.
type devMailerOnlyLogin struct{ NoopEmailSender }

func (devMailerOnlyLogin) SendLoginCode(ctx context.Context, to, code string) error {
	return nil
}

func TestNoopEmailSender_SatisfiesPort(t *testing.T) {
	var s EmailSender = NoopEmailSender{}
	var d EmailSender = devMailerOnlyLogin{}
	assert.NotNil(t, s)
	assert.NotNil(t, d)
}

func TestNoopEmailSender_AllMethodsNoop(t *testing.T) {
	s := NoopEmailSender{}
	ctx := context.Background()
	require.NoError(t, s.SendLoginCode(ctx, "a@b.c", "000000"))
	require.NoError(t, s.SendInvite(ctx, "a@b.c", "ws", "inv-1"))
	require.NoError(t, s.SendPasswordReset(ctx, "a@b.c", "https://x/reset"))
	require.NoError(t, s.SendEmailVerification(ctx, "a@b.c", "https://x/verify"))
}
