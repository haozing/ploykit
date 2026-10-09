package metrics

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/trace"
)

func TestFacade_CountersAccumulateInSnapshot(t *testing.T) {
	r := New()

	r.Incr("task_completed")
	r.Incr("task_completed")
	r.Add("outbox_replayed", 3)

	snap := r.Snapshot()
	assert.Equal(t, int64(2), snap["task_completed"])
	assert.Equal(t, int64(3), snap["outbox_replayed"])
}

func TestFacade_CounterHandleWritesMirrorTrackOnly(t *testing.T) {
	r := New()
	r.Counter("legacy_handle").Add(5)

	assert.Equal(t, int64(5), r.Snapshot()["legacy_handle"])

	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.NotContains(t, rec.Body.String(), "legacy_handle")
}

func TestFacade_AttrsCounterUsesCanonicalSnapshotKey(t *testing.T) {
	r := New()
	r.IncrAttrs("sweep_hits", map[string]string{"kind": "runtime_recovery"})
	r.IncrAttrs("sweep_hits", map[string]string{"kind": "runtime_recovery"})
	r.IncrAttrs("sweep_hits", map[string]string{"kind": "interrupt_timeout"})

	snap := r.Snapshot()
	assert.Equal(t, int64(2), snap[`sweep_hits{kind=runtime_recovery}`])
	assert.Equal(t, int64(1), snap[`sweep_hits{kind=interrupt_timeout}`])

	assert.NotContains(t, snap, "sweep_hits")
}

func TestFacade_AttrsKeySortedRegardlessOfConstructionOrder(t *testing.T) {
	r := New()

	r.IncrAttrs("multi", map[string]string{"zone": "z1", "kind": "k1"})
	r.IncrAttrs("multi", map[string]string{"kind": "k1", "zone": "z1"})

	assert.Equal(t, int64(2), r.Snapshot()[`multi{kind=k1,zone=z1}`])
}

func TestFacade_GaugeMirrorStoresTruncatedInt(t *testing.T) {
	r := New()
	r.Gauge("ws_connections", 3)
	r.Gauge("ws_connections", 3.7)

	assert.Equal(t, int64(3), r.Snapshot()["ws_connections"])
}

func TestFacade_ObserveHasNoMirror(t *testing.T) {
	r := New()
	r.Observe("wait_seconds", 0.42)

	assert.NotContains(t, r.Snapshot(), "wait_seconds")
}

func TestFacade_BadInstrumentNameDegradesToNoOp(t *testing.T) {
	r := New()

	r.Add("BadName", 1)
	assert.Equal(t, int64(1), r.Snapshot()["BadName"])

	r.Observe("BadHisto", 1)
	r.Gauge("BadGauge", 1)
}

func TestNew_RegistriesIndependent(t *testing.T) {
	a, b := New(), New()
	a.Incr("task_completed")
	b.Incr("task_failed")

	assert.Equal(t, int64(1), a.Snapshot()["task_completed"])
	assert.Equal(t, int64(0), b.Snapshot()["task_completed"])
	assert.Equal(t, int64(1), b.Snapshot()["task_failed"])
}

func TestNew_WithHistogramBuckets(t *testing.T) {
	r := New(WithHistogramBuckets("wait_seconds", []float64{0.5, 1, 5}))
	r.Observe("wait_seconds", 0.42)

	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	assert.Contains(t, rec.Body.String(), `wait_seconds_bucket{le="0.5"} 1`)
}

func TestNew_MultipleBucketOptionsCoexist(t *testing.T) {
	r := New(
		WithHistogramBuckets("wait_a", []float64{0.5, 5}),
		WithHistogramBuckets("wait_b", []float64{1, 10}),
	)
	r.Observe("wait_a", 0.3)
	r.Observe("wait_b", 0.7)

	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	body := rec.Body.String()
	assert.Contains(t, body, `wait_a_bucket{le="0.5"} 1`)
	assert.Contains(t, body, `wait_b_bucket{le="1"} 1`)
}

func TestInstallGlobal_SetsTraceContextPropagator(t *testing.T) {
	r := New()
	r.InstallGlobal()
	t.Cleanup(func() {

		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator())
		otel.SetMeterProvider(sdkmetric.NewMeterProvider())
	})

	carrier := propagation.HeaderCarrier(http.Header{"Traceparent": {
		"00-0af7651916cd43dd8448eb211cdef345-00f067aa0ba902b7-01"}})
	ctx := otel.GetTextMapPropagator().Extract(t.Context(), carrier)

	sc := trace.SpanContextFromContext(ctx)
	require.True(t, sc.IsValid(), "InstallGlobal 后全局传播器应为 TraceContext")
	assert.Equal(t, "0af7651916cd43dd8448eb211cdef345", sc.TraceID().String())
}
