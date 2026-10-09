package renderx

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const DefaultIndexNowEndpoint = "https://api.indexnow.org/indexnow"

type SitemapOptions struct {
	Filter func(route RouteSpec, location string, params Params) bool

	Registry *Registry
}

func SitemapHandler(routes []RouteSpec, baseURL string, opts SitemapOptions) http.Handler {
	reg := opts.Registry
	if reg == nil {
		reg = defaultRegistry
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		locs, err := sitemapLocations(r.Context(), routes, baseURL, opts, reg)
		if err != nil {
			http.Error(w, "sitemap 生成失败", http.StatusInternalServerError)
			return
		}
		var buf bytes.Buffer
		buf.WriteString(xml.Header)
		buf.WriteString(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + "\n")
		for _, loc := range locs {
			buf.WriteString("  <url><loc>")
			xml.EscapeText(&buf, []byte(loc))
			buf.WriteString("</loc></url>\n")
		}
		buf.WriteString("</urlset>\n")
		w.Header().Set("Content-Type", "application/xml; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buf.Bytes())
	})
}

func sitemapLocations(ctx context.Context, routes []RouteSpec, baseURL string, opts SitemapOptions, reg *Registry) ([]string, error) {
	base := strings.TrimSuffix(baseURL, "/")
	var locs []string
	for _, rt := range routes {
		if rt.Render != ModeStatic {
			continue
		}
		if !hasParams(rt.Path) {
			if opts.Filter == nil || opts.Filter(rt, rt.Path, nil) {
				locs = append(locs, base+rt.Path)
			}
			continue
		}
		fn, err := reg.LookupPaths(rt.Path)
		if err != nil {
			return nil, fmt.Errorf("%w: sitemap 枚举 %q 需要 Paths", ErrMissingPaths, rt.Path)
		}
		instances, err := fn(ctx)
		if err != nil {
			return nil, fmt.Errorf("renderx: sitemap 枚举 %q 失败: %w", rt.Path, err)
		}
		for _, pp := range instances {
			loc, ok := ExpandPath(rt.Path, pp.Params)
			if !ok {
				continue
			}
			if opts.Filter != nil && !opts.Filter(rt, loc, pp.Params) {
				continue
			}
			locs = append(locs, base+loc)
		}
	}
	sort.Strings(locs)
	return locs, nil
}

var indexNowClient = &http.Client{Timeout: 30 * time.Second}

type IndexNowDeps struct {
	Endpoint string

	Key string

	Host string

	Client *http.Client
}

func IndexNow(ctx context.Context, deps IndexNowDeps, urls []string) error {
	if deps.Key == "" || deps.Host == "" {
		return errors.New("renderx: IndexNow 需要 Key 与 Host")
	}
	if len(urls) == 0 {
		return nil
	}
	endpoint := deps.Endpoint
	if endpoint == "" {
		endpoint = DefaultIndexNowEndpoint
	}
	client := deps.Client
	if client == nil {
		client = indexNowClient
	}
	body, err := json.Marshal(struct {
		Host    string   `json:"host"`
		Key     string   `json:"key"`
		URLList []string `json:"urlList"`
	}{Host: deps.Host, Key: deps.Key, URLList: urls})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("renderx: IndexNow 推送失败: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("renderx: IndexNow 推送被拒: HTTP %d（key 校验未通过或 host 不符？）", resp.StatusCode)
	}
	return nil
}
