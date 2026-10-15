package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClassifyUA(t *testing.T) {
	cases := []struct{ ua, want string }{
		// Googlebot family
		{"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", BotGoogle},
		{"Mozilla/5.0 (compatible; Google-InspectionTool/1.0)", BotGoogle},
		{"Mozilla/5.0 (compatible; GoogleOther)", BotGoogle},
		{"AdsBot-Google (+http://www.google.com/adsbot.html)", BotGoogle},
		// AI crawlers
		{"Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", BotAI},
		{"Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", BotAI},
		{"Mozilla/5.0 (compatible; PerplexityBot/1.0)", BotAI},
		{"CCBot/2.0 (https://commoncrawl.org/faq/)", BotAI},
		{"Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)", BotAI},
		{"Mozilla/5.0 (compatible; Applebot-Extended/0.1)", BotAI},
		{"meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", BotAI},
		// Other search engines
		{"Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", BotSearch},
		{"Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)", BotSearch},
		{"Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)", BotSearch},
		{"Mozilla/5.0 (compatible; Applebot/0.3; +http://www.apple.com/go/applebot)", BotSearch},
		{"DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)", BotSearch},
		// Social preview fetchers
		{"Twitterbot/1.0", BotSocial},
		{"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", BotSocial},
		{"Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", BotSocial},
		{"WhatsApp/2.23.20.0", BotSocial},
		// Tools, probes, scanners
		{"curl/8.4.0", BotTool},
		{"Wget/1.21.4", BotTool},
		{"python-requests/2.31.0", BotTool},
		{"Go-http-client/1.1", BotTool},
		{"kube-probe/1.29", BotTool},
		{"Mozilla/5.0 (compatible; UptimeRobot/2.0)", BotTool},
		{"Mozilla/5.0 zgrab/0.x", BotTool},
		{"Mozilla/5.0 (compatible; SomeUnnamedBot/1.0)", BotTool},
		{"Mozilla/5.0 (compatible; mystery-crawler)", BotTool},
		// Humans
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", BotHuman},
		{"Mozilla/5.0 (Linux; Android 13; CUBOT_X20) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", BotHuman},
		// audit 补录（2026-10-15）：漏判批
		{"Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)", BotSearch},
		{"Mozilla/5.0 (compatible; ImagesiftBot; +imagesift.com)", BotAI},
		{"omgili/0.5 +http://omgili.com", BotSearch},
		{"Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)", BotSearch},
		{"uptime-kuma/1.23.0", BotTool},
		{"Checkly/1.0 (+https://www.checklyhq.com)", BotTool},
		{"reqwest/0.12.5", BotTool},
		{"PostmanRuntime/7.37.0", BotTool},
		{"insomnia/9.2.0", BotTool},
		{"HTTPie/3.2.2", BotTool},
		{"GuzzleHttp/7", BotTool},
		{"libwww-perl/6.77", BotTool},
		{"Dart/3.5 (dart:io)", BotTool},
		{"Dalvik/2.1.0 (Linux; U; Android 14)", BotTool},
		// UA-less scripts
		{"", BotTool},
		{"   ", BotTool},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, ClassifyUA(c.ua), "ClassifyUA(%q)", c.ua)
	}
}

func TestTrafficCountsBotTierStatus(t *testing.T) {
	m := NewMount(Config{})
	h := m.Traffic(TrafficConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Renderx-Tier", "cache")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/blog/hello", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	assert.Equal(t, int64(1),
		m.Registry().Snapshot()[`ploykit_traffic_requests{bot=google,status=2xx,tier=cache}`])
}

func TestTrafficCustomHeaderAndClassifier(t *testing.T) {
	m := NewMount(Config{})
	h := m.Traffic(TrafficConfig{
		Header:   "X-Custom-Tier",
		Classify: func(string) string { return "myclass" },
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Custom-Tier", "render")
		w.WriteHeader(http.StatusNotFound)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	assert.Equal(t, int64(1),
		m.Registry().Snapshot()[`ploykit_traffic_requests{bot=myclass,status=4xx,tier=render}`])
}

func TestTrafficDefaultStatusAndMissingTier(t *testing.T) {
	m := NewMount(Config{})
	// handler writes no header and never calls WriteHeader: net/http answers
	// 200 — the counter must record the effective status, not zero.
	h := m.Traffic(TrafficConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("x"))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, int64(1),
		m.Registry().Snapshot()[`ploykit_traffic_requests{bot=tool,status=2xx,tier=none}`])
}

func TestTrafficSanitizesUnboundedLabelValues(t *testing.T) {
	m := NewMount(Config{})
	h := m.Traffic(TrafficConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Renderx-Tier", "/blog/some/dynamic/path")
		w.WriteHeader(http.StatusInternalServerError)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	// a path leaking into the tier header must not become a label value
	assert.Equal(t, int64(1),
		m.Registry().Snapshot()[`ploykit_traffic_requests{bot=tool,status=5xx,tier=other}`])
}

func TestTrafficDisabledMountIsPassThrough(t *testing.T) {
	off := false
	m := NewMount(Config{Enabled: &off})
	var hits int
	h := m.Traffic(TrafficConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
	}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, 1, hits)
	assert.Nil(t, m.Registry())
}

func TestTrafficCountsPanicAs5xx(t *testing.T) {
	m := NewMount(Config{})
	h := m.Traffic(TrafficConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("render bug")
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", "curl/8.4.0")

	assert.Panics(t, func() { h.ServeHTTP(rec, req) }, "panic 应原样上抛")

	// 计数必须已落（上层 Recover 会写 500；没写过响应的 panic 记 5xx）
	assert.Equal(t, int64(1),
		m.Registry().Snapshot()[`ploykit_traffic_requests{bot=tool,status=5xx,tier=none}`])
}

func TestTrafficCustomClassifierFoldsInvalidTokens(t *testing.T) {
	// 定制分类器返回非法 token（大写/超长/空）时应折叠为 other/none，
	// 不让无界值进入标签（与 sanitizeLabel 契约一致）
	responses := []struct{ in, want string }{
		{"MyClass", "other"},
		{strings.Repeat("x", 100), "other"},
		{"", "none"},
		{"ok-token_1", "ok-token_1"},
	}
	for _, c := range responses {
		m2 := NewMount(Config{})
		h := m2.Traffic(TrafficConfig{Classify: func(string) string { return c.in }})(
			http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
		key := `ploykit_traffic_requests{bot=` + c.want + `,status=2xx,tier=none}`
		assert.Equal(t, int64(1), m2.Registry().Snapshot()[key], "classify 返回 %q", c.in)
	}
}

func TestTrafficWriterFlushesThrough(t *testing.T) {
	m := NewMount(Config{})
	flushed := false
	under := httptest.NewRecorder() // httptest.ResponseRecorder implements http.Flusher
	h := m.Traffic(TrafficConfig{})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, ok := w.(http.Flusher)
		if !ok {
			t.Error("trafficWriter 应透传 Flusher")
			return
		}
		f.Flush()
		flushed = true
	}))
	h.ServeHTTP(under, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.True(t, flushed)
}
