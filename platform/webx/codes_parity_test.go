package webx

import (
	"testing"

	"github.com/haozing/ploykit/internal/contract/apierr"
)

func TestCodeParity_WithAPIErrContract(t *testing.T) {
	cases := []struct {
		name   string
		webx   string
		apierr string
	}{
		{"Unauthenticated", CodeUnauthenticated, apierr.Unauthenticated},
		{"Forbidden", CodeForbidden, apierr.Forbidden},
		{"NotFound", CodeNotFound, apierr.NotFound},
		{"Validation", CodeValidation, apierr.Validation},
		{"RateLimited", CodeRateLimited, apierr.RateLimited},
		{"Internal", CodeInternal, apierr.Internal},
	}
	for _, c := range cases {
		if c.webx != c.apierr {
			t.Errorf("%s 漂移：webx=%q apierr=%q（同名概念必须同值，双侧同步修改）",
				c.name, c.webx, c.apierr)
		}
	}
}

func TestCodeParity_ConflictIntentionallyDifferent(t *testing.T) {
	if CodeConflict != "E_CONFLICT" {
		t.Errorf("webx.CodeConflict = %q, want E_CONFLICT", CodeConflict)
	}
	if apierr.Conflict != "E_REVISION_CONFLICT" {
		t.Errorf("apierr.Conflict = %q, want E_REVISION_CONFLICT（乐观锁专属码）", apierr.Conflict)
	}
	if CodeConflict == apierr.Conflict {
		t.Error("两源 Conflict 已同值：若属有意合并请更新本注释并删除此断言")
	}
}
