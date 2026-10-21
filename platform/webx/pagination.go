package webx

import (
	"net/http"
	"strconv"
)

// Pagination defaults shared by every list endpoint. They mirror the
// convention the HTTP API documents (`pageNum` 1-based, `pageSize` capped) so
// a product does not have to re-derive the numbers.
const (
	DefaultPageNum  = 1
	DefaultPageSize = 20
	MaxPageSize     = 100
)

// Pagination is a parsed and clamped `?pageNum=&pageSize=` pair.
type Pagination struct {
	PageNum  int
	PageSize int
}

// Offset is the SQL OFFSET for this page.
func (p Pagination) Offset() int { return (p.PageNum - 1) * p.PageSize }

// ParsePagination reads `pageNum` / `pageSize` from the request and clamps
// them into a usable range:
//
//   - a missing, non-numeric, or < 1 pageNum becomes 1
//   - a missing, non-numeric, or < 1 pageSize becomes defaultSize
//   - a pageSize above maxSize becomes maxSize
//
// Clamping (rather than rejecting) is deliberate: a pagination parameter is
// never the reason a read should fail, and the alternative — each handler
// inventing its own rule — produces the observable mess this helper replaces
// (one endpoint clamping pageSize=999 to 100, another honoring it verbatim,
// a third silently returning the default).
//
// Pass 0 for defaultSize/maxSize to use DefaultPageSize/MaxPageSize.
func ParsePagination(r *http.Request, defaultSize, maxSize int) Pagination {
	if defaultSize <= 0 {
		defaultSize = DefaultPageSize
	}
	if maxSize <= 0 {
		maxSize = MaxPageSize
	}
	if defaultSize > maxSize {
		defaultSize = maxSize
	}

	q := r.URL.Query()
	pageNum := parseIntOr(q.Get("pageNum"), DefaultPageNum)
	if pageNum < 1 {
		pageNum = DefaultPageNum
	}
	pageSize := parseIntOr(q.Get("pageSize"), defaultSize)
	if pageSize < 1 {
		pageSize = defaultSize
	}
	if pageSize > maxSize {
		pageSize = maxSize
	}
	return Pagination{PageNum: pageNum, PageSize: pageSize}
}

func parseIntOr(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}
