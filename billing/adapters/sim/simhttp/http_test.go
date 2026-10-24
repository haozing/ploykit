package simhttp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/billing/app"
)

// DEV-ONLY 兜底:Production=true 必须拒绝挂载(panic——伪造支付 webhook 的
// 接口绝不能进生产,接线侧双重门控之外的最后防线)。
func TestMountPanicsInProduction(t *testing.T) {
	defer func() {
		r := recover()
		require.NotNil(t, r, "Production=true 必须拒绝挂载(panic 兜底)")
		assert.Contains(t, fmtString(r), "DEV-ONLY")
	}()
	Mount(http.NewServeMux(), Deps{Production: true})
}

func fmtString(v any) string { b, _ := json.Marshal(v); return string(b) }

// 未知渠道/非 sim 渠道一律 404(在触达 Svc 之前拒绝,无需装配服务)。
func TestHandleEvent_RejectsUnknownChannel(t *testing.T) {
	reg := app.NewChannelRegistry()
	deps := Deps{Channels: reg}
	mux := http.NewServeMux()
	Mount(mux, deps)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	for _, channel := range []string{"waffo", "stripe", "paypal", "manual", "nope"} {
		resp, err := http.Post(srv.URL+"/dev/billing-sim/"+channel+"/event", "application/json",
			bytes.NewReader([]byte(`{"event_type":"x"}`)))
		require.NoError(t, err)
		_ = resp.Body.Close()
		assert.Equal(t, http.StatusNotFound, resp.StatusCode, "真渠道名/未知名都不是 sim 渠道: "+channel)
	}
}

// 端到端(下单→事件)行为与全部旋钮在 sim 包 pipeline_db_test.go 里经真实
// BillingService 验收;本包 hermetic 面只守 DEV-ONLY 兜底与渠道门。
