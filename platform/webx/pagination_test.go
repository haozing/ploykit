package webx

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParsePaginationDefaults(t *testing.T) {
	r := httptest.NewRequest("GET", "/items", nil)
	p := ParsePagination(r, 0, 0)
	require.Equal(t, Pagination{PageNum: 1, PageSize: 20}, p)
	require.Equal(t, 0, p.Offset())
}

func TestParsePaginationParsesAndClamps(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  Pagination
	}{
		{"valid pair", "?pageNum=3&pageSize=50", Pagination{3, 50}},
		{"pageNum zero", "?pageNum=0&pageSize=10", Pagination{1, 10}},
		{"pageNum negative", "?pageNum=-5", Pagination{1, 20}},
		{"pageNum not a number", "?pageNum=abc", Pagination{1, 20}},
		{"pageSize zero", "?pageSize=0", Pagination{1, 20}},
		{"pageSize negative", "?pageSize=-1", Pagination{1, 20}},
		{"pageSize not a number", "?pageSize=abc", Pagination{1, 20}},
		// The whole point of the helper: an oversized pageSize is clamped, not honored.
		{"pageSize above max", "?pageSize=999", Pagination{1, 100}},
		{"pageSize exactly max", "?pageSize=100", Pagination{1, 100}},
		{"pageSize one above max", "?pageSize=101", Pagination{1, 100}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/items"+c.query, nil)
			require.Equal(t, c.want, ParsePagination(r, 0, 0))
		})
	}
}

func TestParsePaginationCustomDefaults(t *testing.T) {
	r := httptest.NewRequest("GET", "/items", nil)
	require.Equal(t, Pagination{1, 10}, ParsePagination(r, 10, 50))

	// pageSize clamps to the caller's max, not the package max.
	r = httptest.NewRequest("GET", "/items?pageSize=80", nil)
	require.Equal(t, Pagination{1, 50}, ParsePagination(r, 10, 50))

	// A default above max collapses to max instead of producing an out-of-range page.
	r = httptest.NewRequest("GET", "/items", nil)
	require.Equal(t, Pagination{1, 50}, ParsePagination(r, 200, 50))
}

func TestPaginationOffset(t *testing.T) {
	require.Equal(t, 0, Pagination{PageNum: 1, PageSize: 20}.Offset())
	require.Equal(t, 40, Pagination{PageNum: 3, PageSize: 20}.Offset())
	require.Equal(t, 50, Pagination{PageNum: 2, PageSize: 50}.Offset())
}
