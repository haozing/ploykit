package metrics

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSnapKey_ValueEscaping(t *testing.T) {
	r := New()

	r.IncrAttrs("m", map[string]string{"k": "a,b=c"})
	r.IncrAttrs("m", map[string]string{"k": "a", "b": "c"})
	r.IncrAttrs("m", map[string]string{"k": `a\b`})

	r.IncrAttrs("m", map[string]string{"route": "/api/tasks/{id}"})

	snap := r.Snapshot()
	assert.Equal(t, int64(1), snap[`m{k=a\,b\=c}`], "值内元字符必须转义")
	assert.Equal(t, int64(1), snap[`m{b=c,k=a}`], "双键形态独立成键")
	assert.Equal(t, int64(1), snap[`m{k=a\\b}`], "字面反斜杠双写，不与转义折叠")
	assert.Equal(t, int64(1), snap[`m{route=/api/tasks/{id}}`], "花括号不转义（存量键兼容）")
	assert.Len(t, snap, 4, "四个属性集合必须是四个不同镜像键")
}

func TestSnapKey_PlainValuesUnchanged(t *testing.T) {
	assert.Equal(t, `sweep_hits{kind=runtime_recovery}`,
		snapKey("sweep_hits", map[string]string{"kind": "runtime_recovery"}))
	assert.Equal(t, `multi{kind=k1,zone=z1}`,
		snapKey("multi", map[string]string{"zone": "z1", "kind": "k1"}))
	assert.Equal(t, `ploykit_http_requests{method=GET,route=/api/tasks/{id}}`,
		snapKey("ploykit_http_requests", map[string]string{"method": "GET", "route": "/api/tasks/{id}"}))
}

func TestNewMount_DisabledDropsWithRegistry(t *testing.T) {
	reg := New()
	reg.Incr("kept_on_original")

	off := false
	m := NewMount(Config{Enabled: &off}, WithRegistry(reg))

	assert.Nil(t, m.Registry(), "关闭态丢弃 WithRegistry（不返回零装配外的句柄）")
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)

	assert.Equal(t, int64(1), reg.Snapshot()["kept_on_original"])
}

func TestFacade_SameNameCounterAndGauge(t *testing.T) {
	r := New()
	r.Add("dual", 5)
	assert.Equal(t, int64(5), r.Snapshot()["dual"])
	r.Gauge("dual", 3)
	assert.Equal(t, int64(3), r.Snapshot()["dual"], "镜像轨同名折叠：Gauge Store 覆写 Add 累加")
	r.Add("dual", 1)
	assert.Equal(t, int64(4), r.Snapshot()["dual"], "Add 在覆写后基数上继续累加")
}

func TestRegistry_ConcurrentAccess(t *testing.T) {
	r := New()
	const workers, iters = 8, 100

	var wg sync.WaitGroup
	for g := 0; g < workers; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			key := "w" + strconv.Itoa(g)
			for i := 0; i < iters; i++ {
				r.IncrAttrs("cc", map[string]string{"g": key})
				r.Gauge("gg", float64(i))
				r.Observe("hh", float64(i))
				r.Add("aa", 1)
				_ = r.Snapshot()
			}
		}(g)
	}
	wg.Wait()

	snap := r.Snapshot()
	var labeled int64
	for g := 0; g < workers; g++ {
		labeled += snap["cc{g=w"+strconv.Itoa(g)+"}"]
	}
	assert.Equal(t, int64(workers*iters), labeled, "带标签计数不丢不重")
	assert.Equal(t, int64(workers*iters), snap["aa"], "无标签计数恰为总写入")
	assert.Equal(t, int64(iters-1), snap["gg"], "量规收敛到最后一次覆写（0..99）")
}

func TestNewMount_TokenBuildsSingleHandler(t *testing.T) {
	m := NewMount(Config{Token: "t0k"})
	m.Registry().Incr("x")
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics?token=t0k", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "x_total 1")
}
