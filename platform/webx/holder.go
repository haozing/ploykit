package webx

import (
	"context"
	"net/http"
	"sync/atomic"
)

type PrincipalCell struct{ p atomic.Pointer[Principal] }

func (c *PrincipalCell) Set(p *Principal) { c.p.Store(p) }

func (c *PrincipalCell) Get() *Principal { return c.p.Load() }

type principalCellKey struct{}

func withPrincipalCell(ctx context.Context, cell *PrincipalCell) context.Context {
	return context.WithValue(ctx, principalCellKey{}, cell)
}

func principalCellFrom(ctx context.Context) *PrincipalCell {
	cell, _ := ctx.Value(principalCellKey{}).(*PrincipalCell)
	return cell
}

func fillPrincipalCell(ctx context.Context, p *Principal) {
	if cell := principalCellFrom(ctx); cell != nil {
		cell.Set(p)
	}
}

func PrincipalHolder() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(withPrincipalCell(r.Context(), &PrincipalCell{})))
		})
	}
}
