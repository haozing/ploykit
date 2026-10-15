package metrics

import (
	"net/http"
	"regexp"
	"strings"
)

// Traffic counting for the public/rendered surface: how much traffic came
// from crawlers vs humans, what serving layer answered (cache hit vs
// on-the-spot render), and whether crawlers got errors. This is the
// server-side SEO observation that third-party analytics structurally cannot
// provide — a script beacon never runs for a crawler. Counts are anonymous
// and carry no per-request storage: labels are bounded classes, never paths
// or user agents (per-page detail is deliberately absent here; that is the
// deferred visitor-analytics product, see docs/visitor-analytics.md).
const (
	MetricTrafficRequests = "ploykit_traffic_requests"

	labelBot    = "bot"
	labelTier   = "tier"
	labelStatus = "status"
)

// Bot classes returned by ClassifyUA.
const (
	// BotHuman is the default for everything that is not a recognized bot —
	// including unmatched crawlers the heuristic does not know.
	BotHuman = "human"
	// BotGoogle is the Googlebot family; kept separate because it is the
	// crawler whose behavior products actually act on.
	BotGoogle = "google"
	// BotSearch covers the remaining search-engine crawlers (Bing, Yandex,
	// Baidu, DuckDuckGo, Applebot plain, …).
	BotSearch = "search"
	// BotAI covers LLM / AI-answer crawlers (GPTBot, ClaudeBot, PerplexityBot,
	// CCBot, Bytespider, …) — the crawler class that grew fastest.
	BotAI = "ai"
	// BotSocial covers link-preview fetchers (Twitterbot, Slackbot, …).
	BotSocial = "social"
	// BotTool covers libraries, probes and scanners (curl, kube-probe,
	// uptime monitors, nmap). A UA-less request is classified here too —
	// scripts far outnumber real clients that omit the header.
	BotTool = "tool"
)

// TrafficConfig configures Mount.Traffic.
type TrafficConfig struct {
	// Header names the response header carrying the serving tier (see
	// renderx.HeaderTier, whose literal "X-Renderx-Tier" is the default). A
	// response without the header is counted as tier "none".
	Header string

	// Classify overrides the User-Agent classifier; nil uses ClassifyUA.
	// Values must be short lowercase tokens (anything else is folded into
	// "other") to keep label cardinality bounded.
	Classify func(ua string) string
}

const defaultTrafficHeader = "X-Renderx-Tier"

// Traffic returns the counting middleware to wrap around the public render
// handler (the renderx/SPA catch-all), after Mount.Middleware in the chain.
// It records one ploykit_traffic_requests{bot,tier,status} increment per
// request. On a disabled mount it is a pass-through, the same silent
// degradation as Middleware. Bot classification is a UA heuristic — good
// enough for observation, worthless as a security control (UA is spoofable).
func (m *Mount) Traffic(cfg TrafficConfig) func(http.Handler) http.Handler {
	if m.reg == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	header := cfg.Header
	if header == "" {
		header = defaultTrafficHeader
	}
	classify := cfg.Classify
	if classify == nil {
		classify = ClassifyUA
	}
	reg := m.reg
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tw := &trafficWriter{ResponseWriter: w}
			// Record from a defer so the count survives a downstream panic
			// (an upstream Recover writes the 500; the request must not
			// vanish from the series). A panic that never wrote a response is
			// classified 5xx; the panic itself is re-raised untouched.
			defer func() {
				rec := recover()
				status := tw.status()
				if rec != nil && !tw.wrote {
					status = http.StatusInternalServerError
				}
				reg.IncrAttrs(MetricTrafficRequests, map[string]string{
					labelBot:    sanitizeLabel(classify(r.UserAgent())),
					labelTier:   sanitizeLabel(tw.Header().Get(header)),
					labelStatus: statusClass(status),
				})
				if rec != nil {
					panic(rec)
				}
			}()
			next.ServeHTTP(tw, r)
		})
	}
}

type trafficWriter struct {
	http.ResponseWriter
	code  int
	wrote bool
}

func (w *trafficWriter) WriteHeader(code int) {
	if code >= 200 && !w.wrote {
		w.wrote = true
		w.code = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *trafficWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.wrote = true
		w.code = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// Flush delegates to the underlying writer when it supports flushing, so
// downstream handlers and the gzip layer can flush chunks through (the same
// always-implemented/delegated-if-available shape as the example's gzip
// writer). SetWriteDeadline/Hijack go through Unwrap + http.ResponseController.
func (w *trafficWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap keeps http.ResponseController (Flush/SetWriteDeadline) working
// through the wrapper.
func (w *trafficWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *trafficWriter) status() int {
	if !w.wrote {
		return http.StatusOK
	}
	return w.code
}

var labelTokenRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,23}$`)

func sanitizeLabel(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "none"
	}
	if !labelTokenRE.MatchString(v) {
		return "other"
	}
	return v
}

func statusClass(code int) string {
	switch {
	case code >= 200 && code < 300:
		return "2xx"
	case code >= 300 && code < 400:
		return "3xx"
	case code >= 400 && code < 500:
		return "4xx"
	case code >= 500 && code < 600:
		return "5xx"
	default:
		return "other"
	}
}

type botRule struct {
	class  string
	tokens []string
}

// Order matters: earlier entries win, so class-specific tokens must precede
// broader ones (e.g. applebot-extended before applebot, googlebot before the
// generic "bot" boundary scan).
var botRules = []botRule{
	{BotGoogle, []string{
		"googlebot", "google-inspectiontool", "storebot-google", "googleother",
		"adsbot-google", "mediapartners-google", "feedfetcher-google", "apis-google",
	}},
	{BotAI, []string{
		"gptbot", "chatgpt-user", "oai-searchbot", "claudebot", "claude-web",
		"anthropic-ai", "perplexitybot", "perplexity-user", "duckassistbot",
		"ccbot", "bytespider", "amazonbot", "applebot-extended",
		"meta-externalagent", "meta-externalfetcher", "cohere-ai", "youbot",
		"mistralai-user", "google-cloudvertexbot", "diffbot", "imagesiftbot",
	}},
	{BotSearch, []string{
		"bingbot", "bingpreview", "yandex", "baiduspider", "duckduckbot",
		"applebot", "sogou", "360spider", "haosouspider", "yisouspider",
		"seznambot", "qwantify", "naverbot", "yeti", "petalbot",
		"exabot", "teoma", "slurp", "msnbot", "omgili", "barkrowler",
	}},
	{BotSocial, []string{
		"twitterbot", "facebookexternalhit", "facebookcatalog", "slackbot",
		"discordbot", "telegrambot", "whatsapp", "linkedinbot", "pinterest",
		"redditbot", "skypeuripreview", "vkshare", "embedly", "quora link preview",
		"nuzzel", "bitlybot", "outbrain", "w3c_validator",
	}},
	{BotTool, []string{
		"curl/", "wget/", "python-requests", "python-urllib", "httpx/", "aiohttp",
		"go-http-client", "java/", "okhttp", "axios/", "node-fetch", "undici",
		"reqwest/", "postmanruntime", "insomnia", "httpie", "guzzlehttp",
		"libwww-perl", "dart/", "dalvik",
		"headlesschrome", "phantomjs", "playwright", "puppeteer", "lighthouse",
		"pingdom", "uptimerobot", "uptime-kuma", "checkly", "statuscake",
		"site24x7", "newrelic", "datadog", "prometheus", "blackbox_exporter",
		"kube-probe", "elb-healthchecker", "healthcheck", "zgrab", "nmap",
		"masscan", "sqlmap", "nikto", "gobuster",
	}},
}

// genericBotRE catches unnamed crawlers that self-identify with "bot" as a
// standalone token or a versioned name ("SomeBot/1.0"); the standalone-token
// form keeps phone models like CUBOT (no slash, letters around) out. Plus the
// common generic words.
var genericBotRE = regexp.MustCompile(`bot/|(?:^|[^a-z0-9])bot(?:[^a-z0-9]|$)|crawler|spider|scrapy`)

// ClassifyUA buckets a User-Agent header into the Bot* classes. It is a
// heuristic over a curated token table: exported so products can inspect it,
// extend the shape with TrafficConfig.Classify, or assert against it in tests.
func ClassifyUA(ua string) string {
	if strings.TrimSpace(ua) == "" {
		return BotTool
	}
	lower := strings.ToLower(ua)
	for _, rule := range botRules {
		for _, token := range rule.tokens {
			if strings.Contains(lower, token) {
				return rule.class
			}
		}
	}
	if genericBotRE.MatchString(lower) {
		return BotTool
	}
	return BotHuman
}
