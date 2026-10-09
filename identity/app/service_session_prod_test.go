package app

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/webx"
)

func i15Now() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }

func TestNewSessionService_ProductionDevCodePanics_I15(t *testing.T) {
	require.PanicsWithValue(t,
		"identity: SessionConfig.Production=true but DevCode is set (I15): universal login codes must not exist in production",
		func() {
			NewSessionService(nil, nil, SessionConfig{Production: true, DevCode: "000000"}, time.Hour, 0, i15Now)
		})
}

func TestNewSessionService_DevCodeAllowedOutsideProduction_I15(t *testing.T) {
	require.NotPanics(t, func() {
		NewSessionService(nil, nil, SessionConfig{DevCode: "000000"}, time.Hour, 0, i15Now)
	})

	require.NotPanics(t, func() {
		NewSessionService(nil, nil, SessionConfig{Production: true}, time.Hour, 0, i15Now)
	})
}

func TestVerifyCode_ProductionBelt_I15(t *testing.T) {
	svc := &SessionService{

		cfg: SessionConfig{Production: true, DevCode: "000000"},
		now: i15Now,
	}
	_, err := svc.VerifyCode(t.Context(), "iph", "ua", "user@example.com", "000000")
	require.Error(t, err, "Production 下万能码必须被拒绝（运行期保险带）")
	var we *webx.Error
	require.ErrorAs(t, err, &we)
	assert.Equal(t, 401, we.Status)
	assert.Equal(t, webx.CodeUnauthenticated, we.Code)
}
