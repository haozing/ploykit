package metrics

import (
	"net/http"
	"sync"
)

type Config struct {
	Enabled *bool

	Path string

	Token string
}

const defaultPath = "/metrics"

func WithRegistry(r *Registry) Option {
	return func(c *config) { c.registry = r }
}

type Mount struct {
	reg     *Registry
	path    string
	handler http.Handler

	seenMu sync.Mutex
	seen   map[string]struct{}
}

func NewMount(cfg Config, opts ...Option) *Mount {
	var c config
	for _, o := range opts {
		o(&c)
	}
	if cfg.Path == "" {
		cfg.Path = defaultPath
	}
	if cfg.Enabled != nil && !*cfg.Enabled {
		return &Mount{path: cfg.Path}
	}

	reg := c.registry
	if reg == nil {
		hasView := false
		for _, hv := range c.histogramViews {
			if hv.name == MetricHTTPDurationSeconds {
				hasView = true
				break
			}
		}
		if !hasView {
			opts = append(opts, WithHistogramBuckets(MetricHTTPDurationSeconds, DefaultDurationBuckets))
		}
		reg = New(opts...)
	}

	var h http.Handler
	if cfg.Token != "" {
		h = reg.HandlerWithToken(cfg.Token)
	} else {
		h = reg.Handler()
	}
	return &Mount{reg: reg, path: cfg.Path, handler: h}
}

func (m *Mount) Path() string { return m.path }

func (m *Mount) Handler() http.Handler {
	if m.reg == nil {
		return http.NotFoundHandler()
	}
	return m.handler
}

func (m *Mount) Registry() *Registry { return m.reg }
