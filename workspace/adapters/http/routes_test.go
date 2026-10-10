package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/workspace"
	wsapp "github.com/haozing/ploykit/workspace/app"
)

type fakeRepo struct {
	wsapp.Repo
	workspaces map[string]wsapp.Workspace
	members    map[string]wsapp.Member
	deleted    []string

	roleOverrides map[string][]authz.Permission
}

func (f *fakeRepo) ListRoleOverrides(_ context.Context, workspaceID string) (map[string][]authz.Permission, error) {
	out := map[string][]authz.Permission{}
	for k, v := range f.roleOverrides {
		if ws, role, ok := strings.Cut(k, "|"); ok && ws == workspaceID {
			out[role] = v
		}
	}
	return out, nil
}

func (f *fakeRepo) UpsertRolePerms(_ context.Context, workspaceID, role string, perms []authz.Permission, _ time.Time) error {
	f.roleOverrides[workspaceID+"|"+role] = perms
	return nil
}

func (f *fakeRepo) DeleteRolePerms(_ context.Context, workspaceID, role string) error {
	delete(f.roleOverrides, workspaceID+"|"+role)
	return nil
}

func (f *fakeRepo) GetMember(_ context.Context, wsID, userID string) (wsapp.Member, bool, error) {
	m, ok := f.members[wsID+"|"+userID]
	return m, ok, nil
}

func (f *fakeRepo) GetWorkspace(_ context.Context, id string) (wsapp.Workspace, bool, error) {
	ws, ok := f.workspaces[id]
	return ws, ok, nil
}

func (f *fakeRepo) UpdateWorkspaceName(_ context.Context, id, name string, _ time.Time) error {
	ws, ok := f.workspaces[id]
	if !ok {
		return wsapp.ErrNotFound
	}
	ws.Name = name
	f.workspaces[id] = ws
	return nil
}

func (f *fakeRepo) RunInTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	return fn(ctx, nil)
}

func (f *fakeRepo) DeleteWorkspaceCascade(_ context.Context, _ pgx.Tx, wsID string) error {
	if _, ok := f.workspaces[wsID]; !ok {
		return wsapp.ErrNotFound
	}
	f.deleted = append(f.deleted, wsID)
	delete(f.workspaces, wsID)
	return nil
}

func setupMux(t *testing.T, hooks workspace.WorkspaceHooks) (*http.ServeMux, *fakeRepo) {
	t.Helper()
	f := &fakeRepo{
		workspaces: map[string]wsapp.Workspace{
			"ws-1": {ID: "ws-1", Slug: "acme", Name: "Acme", PlanCode: "free"},
		},
		members: map[string]wsapp.Member{
			"ws-1|alice": {UserID: "alice", Role: "owner"},
			"ws-1|carol": {UserID: "carol", Role: "admin"},
			"ws-1|bob":   {UserID: "bob", Role: "member"},
		},
	}
	svc := wsapp.NewWorkspaceService(f, authz.New(nil, nil), nil, nil, wsapp.WorkspaceConfig{MaxPerUser: -1},
		func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) }).
		WithHooks(hooks)
	mux := http.NewServeMux()
	Mount(mux, Deps{Svc: svc, Members: f, Authz: authz.New(nil, nil)})
	return mux, f
}

func do(t *testing.T, mux *http.ServeMux, method, path, body string, p *webx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	var rd *strings.Reader
	if body == "" {
		rd = strings.NewReader("")
	} else {
		rd = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, path, rd)
	if p != nil {
		r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func errCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v (%s)", err, w.Body.String())
	}
	return body.Code
}

func TestRenameRoute(t *testing.T) {
	t.Run("admin 改名 200", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "PATCH", "/api/workspaces/ws-1", `{"name":"新名字"}`,
			&webx.Principal{UserID: "carol"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		var got wsapp.Workspace
		if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		if got.Name != "新名字" {
			t.Fatalf("name = %s", got.Name)
		}
		if f.workspaces["ws-1"].Name != "新名字" {
			t.Fatal("repo not updated")
		}
	})
	t.Run("member 403", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "PATCH", "/api/workspaces/ws-1", `{"name":"x"}`,
			&webx.Principal{UserID: "bob"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d", w.Code)
		}
		if c := errCode(t, w); c != "E_FORBIDDEN" {
			t.Fatalf("code = %s", c)
		}
	})
	t.Run("空名 400", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "PATCH", "/api/workspaces/ws-1", `{"name":""}`,
			&webx.Principal{UserID: "alice"})
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d", w.Code)
		}
		if c := errCode(t, w); c != "E_VALIDATION" {
			t.Fatalf("code = %s", c)
		}
	})
}

func TestDeleteRoute(t *testing.T) {
	t.Run("owner 删除 204", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "", &webx.Principal{UserID: "alice"})
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if len(f.deleted) != 1 || f.deleted[0] != "ws-1" {
			t.Fatalf("deleted = %v", f.deleted)
		}
	})
	t.Run("admin 403（workspace:delete 仅 owner）", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "", &webx.Principal{UserID: "carol"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d", w.Code)
		}
		if c := errCode(t, w); c != "E_FORBIDDEN" {
			t.Fatalf("code = %s", c)
		}
		if len(f.deleted) != 0 {
			t.Fatal("admin must not delete")
		}
	})
	t.Run("BeforeDelete 拦截 409", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{
			BeforeDelete: func(_ context.Context, _ string) error { return errors.New("unpaid") },
		})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "", &webx.Principal{UserID: "alice"})
		if w.Code != http.StatusConflict {
			t.Fatalf("status = %d", w.Code)
		}
		if c := errCode(t, w); c != "E_CONFLICT" {
			t.Fatalf("code = %s", c)
		}
		if len(f.deleted) != 0 {
			t.Fatal("blocked delete must not cascade")
		}
	})
	t.Run("非成员 404", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "", &webx.Principal{UserID: "stranger"})
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d", w.Code)
		}
	})
	t.Run("未认证 401", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "", nil)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d", w.Code)
		}
	})
}

func (f *fakeRepo) ListMembers(_ context.Context, _ string, page, pageSize int) (wsapp.Page[wsapp.Member], error) {
	all := []wsapp.Member{
		{UserID: "m1", Role: "owner"},
		{UserID: "m2", Role: "admin"},
		{UserID: "m3", Role: "member"},
	}
	start := (page - 1) * pageSize
	if start >= len(all) {
		return wsapp.Page[wsapp.Member]{Items: []wsapp.Member{}, Total: len(all)}, nil
	}
	end := min(start+pageSize, len(all))
	return wsapp.Page[wsapp.Member]{Items: all[start:end], Total: len(all)}, nil
}

func (f *fakeRepo) ListInvitations(_ context.Context, wsID string, _, _ int) (wsapp.Page[wsapp.Invitation], error) {
	return wsapp.Page[wsapp.Invitation]{
		Items: []wsapp.Invitation{{ID: "inv-1", WorkspaceID: wsID, Email: "new@example.com", Role: "member"}},
		Total: 1,
	}, nil
}

func (f *fakeRepo) RevokeInvitation(_ context.Context, _ string, invID string, _ time.Time) error {
	if invID == "inv-x" {
		return wsapp.ErrNotFound
	}
	return nil
}

func (f *fakeRepo) ListShareLinks(_ context.Context, _ string, _, _ int) (wsapp.Page[wsapp.ShareLink], error) {
	return wsapp.Page[wsapp.ShareLink]{
		Items: []wsapp.ShareLink{{ID: "link-1", Role: "member", MaxUses: 10}},
		Total: 1,
	}, nil
}

func (f *fakeRepo) RevokeShareLink(_ context.Context, _ string, linkID string, _ time.Time) error {
	if linkID == "link-x" {
		return wsapp.ErrNotFound
	}
	return nil
}

func TestWorkspaceSubroutesStillMounted(t *testing.T) {

	mux, _ := setupMux(t, workspace.WorkspaceHooks{})
	w := do(t, mux, "GET", "/api/workspaces/ws-1/members", "", &webx.Principal{UserID: "bob"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
}

func TestListPaginationQuery_WA8(t *testing.T) {
	decode := func(t *testing.T, w *httptest.ResponseRecorder) wsapp.Page[wsapp.Member] {
		t.Helper()
		var pg wsapp.Page[wsapp.Member]
		if err := json.NewDecoder(w.Body).Decode(&pg); err != nil {
			t.Fatalf("decode: %v (%s)", err, w.Body.String())
		}
		return pg
	}
	bob := &webx.Principal{UserID: "bob"}

	t.Run("缺省参数 → 第一页全量信封", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "GET", "/api/workspaces/ws-1/members", "", bob)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		if pg := decode(t, w); len(pg.Items) != 3 || pg.Total != 3 {
			t.Fatalf("page = %+v", pg)
		}
	})
	t.Run("page=2&page_size=1 → 第二页单条", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "GET", "/api/workspaces/ws-1/members?page=2&page_size=1", "", bob)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		pg := decode(t, w)
		if len(pg.Items) != 1 || pg.Items[0].UserID != "m2" || pg.Total != 3 {
			t.Fatalf("page = %+v", pg)
		}
	})
	t.Run("越界页 → items 空、total 仍是全量", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "GET", "/api/workspaces/ws-1/members?page=9&page_size=2", "", bob)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		if pg := decode(t, w); len(pg.Items) != 0 || pg.Total != 3 {
			t.Fatalf("page = %+v", pg)
		}
	})
	t.Run("非法参数（abc/-1）→ 回落默认（page=1/pageSize=50）", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "GET", "/api/workspaces/ws-1/members?page=abc&page_size=-1", "", bob)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if pg := decode(t, w); len(pg.Items) != 3 || pg.Total != 3 {
			t.Fatalf("page = %+v", pg)
		}
	})
}

func TestInvitationShareLinkReadsForMembers(t *testing.T) {
	t.Run("member 读 invitations 200（{items,total} 信封）", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "GET", "/api/workspaces/ws-1/invitations", "", &webx.Principal{UserID: "bob"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		var pg wsapp.Page[wsapp.Invitation]
		if err := json.NewDecoder(w.Body).Decode(&pg); err != nil || len(pg.Items) != 1 || pg.Total != 1 {
			t.Fatalf("decode=%v page=%+v", err, pg)
		}
	})
	t.Run("member 读 share-links 200（{items,total} 信封）", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "GET", "/api/workspaces/ws-1/share-links", "", &webx.Principal{UserID: "bob"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d", w.Code)
		}
		var pg wsapp.Page[wsapp.ShareLink]
		if err := json.NewDecoder(w.Body).Decode(&pg); err != nil || len(pg.Items) != 1 || pg.Total != 1 {
			t.Fatalf("decode=%v page=%+v", err, pg)
		}
	})
	t.Run("member POST invitation 仍 403（members:invite）", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "POST", "/api/workspaces/ws-1/invitations",
			`{"email":"who@example.com","role":"member"}`, &webx.Principal{UserID: "bob"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if c := errCode(t, w); c != "E_FORBIDDEN" {
			t.Fatalf("code = %s", c)
		}
	})
	t.Run("member DELETE invitation 仍 403（members:invite）", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1/invitations/inv-1", "", &webx.Principal{UserID: "bob"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})
}

type headerMembers struct {
	member wsapp.Member
	found  bool
	err    error
}

func (h headerMembers) GetMember(_ context.Context, _, _ string) (wsapp.Member, bool, error) {
	return h.member, h.found, h.err
}

func TestWorkspaceHeaderCtx_B4(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	memberOfAny := headerMembers{member: wsapp.Member{UserID: "alice", Role: "owner"}, found: true}

	cases := []struct {
		name      string
		members   headerMembers
		header    string
		p         *webx.Principal
		wantCode  int
		wantError string
	}{
		{"缺头 400", headerMembers{found: true}, "", &webx.Principal{UserID: "alice"},
			http.StatusBadRequest, "E_VALIDATION"},
		{"GetMember 出错 500", headerMembers{err: errors.New("db down")}, "ws-1", &webx.Principal{UserID: "alice"},
			http.StatusInternalServerError, "E_INTERNAL"},
		{"非成员 403", headerMembers{}, "ws-1", &webx.Principal{UserID: "stranger"},
			http.StatusForbidden, "E_FORBIDDEN"},
		{"未认证 401", headerMembers{found: true}, "ws-1", nil,
			http.StatusUnauthorized, "E_UNAUTHENTICATED"},

		{"PAT 子集外 403（子集内不含 ws-2）", memberOfAny, "ws-2", &webx.Principal{
			UserID: "alice", Source: webx.SourcePAT,
			Scope: &webx.CredentialScope{WorkspaceIDs: []string{"ws-1"}},
		}, http.StatusForbidden, "E_FORBIDDEN"},
		{"PAT 子集内放行", memberOfAny, "ws-1", &webx.Principal{
			UserID: "alice", Source: webx.SourcePAT,
			Scope: &webx.CredentialScope{WorkspaceIDs: []string{"ws-1"}},
		}, http.StatusOK, ""},
		{"PAT 工作区空集全拒", memberOfAny, "ws-1", &webx.Principal{
			UserID: "alice", Source: webx.SourcePAT,
			Scope: &webx.CredentialScope{WorkspaceIDs: []string{}},
		}, http.StatusForbidden, "E_FORBIDDEN"},
		{"无约束 PAT 不受影响（nil Scope）", memberOfAny, "ws-1", &webx.Principal{
			UserID: "alice", Source: webx.SourcePAT,
		}, http.StatusOK, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
			if tc.header != "" {
				r.Header.Set("X-Workspace-Id", tc.header)
			}
			if tc.p != nil {
				r = r.WithContext(webx.WithPrincipal(r.Context(), tc.p))
			}
			w := httptest.NewRecorder()
			WorkspaceHeaderCtx(tc.members)(next).ServeHTTP(w, r)
			if w.Code != tc.wantCode {
				t.Fatalf("status = %d want %d (body %s)", w.Code, tc.wantCode, w.Body.String())
			}
			if tc.wantError != "" && errCode(t, w) != tc.wantError {
				t.Fatalf("code = %s want %s", errCode(t, w), tc.wantError)
			}
		})
	}
}

func TestWorkspaceCtxDBError_WA1(t *testing.T) {
	newMux := func(members MemberChecker) *http.ServeMux {
		f := &fakeRepo{}
		svc := wsapp.NewWorkspaceService(f, authz.New(nil, nil), nil, nil, wsapp.WorkspaceConfig{MaxPerUser: -1},
			func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) })
		mux := http.NewServeMux()
		Mount(mux, Deps{Svc: svc, Members: members, Authz: authz.New(nil, nil)})
		return mux
	}

	t.Run("GetMember 出错 500", func(t *testing.T) {
		w := do(t, newMux(headerMembers{err: errors.New("db down")}),
			"GET", "/api/workspaces/ws-1/members", "", &webx.Principal{UserID: "alice"})
		if w.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d want 500 (body %s)", w.Code, w.Body.String())
		}
		if c := errCode(t, w); c != "E_INTERNAL" {
			t.Fatalf("code = %s want E_INTERNAL", c)
		}
	})
	t.Run("非成员 404", func(t *testing.T) {
		w := do(t, newMux(headerMembers{}),
			"GET", "/api/workspaces/ws-1/members", "", &webx.Principal{UserID: "stranger"})
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d want 404", w.Code)
		}
	})
	t.Run("成员放行 200", func(t *testing.T) {
		w := do(t, newMux(headerMembers{member: wsapp.Member{UserID: "alice", Role: "owner"}, found: true}),
			"GET", "/api/workspaces/ws-1/members", "", &webx.Principal{UserID: "alice"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d want 200", w.Code)
		}
	})
}

func TestWorkspaceHeaderCtxMemberPassThrough(t *testing.T) {
	var got *webx.Principal
	next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = webx.PrincipalFromRequest(r)
	})
	members := headerMembers{member: wsapp.Member{UserID: "alice", Role: "owner"}, found: true}
	p := &webx.Principal{UserID: "alice"}
	r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	r.Header.Set("X-Workspace-Id", "ws-1")
	r = r.WithContext(webx.WithPrincipal(r.Context(), p))
	w := httptest.NewRecorder()
	WorkspaceHeaderCtx(members)(next).ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if got == nil || got.WorkspaceID != "ws-1" || got.Role != "owner" {
		t.Fatalf("principal not enriched: %+v", got)
	}
}

func (f *fakeRepo) GetMemberUserStatus(_ context.Context, wsID, userID string) (wsapp.Member, string, bool, error) {
	m, ok := f.members[wsID+"|"+userID]
	if !ok {
		return wsapp.Member{}, "", false, nil
	}
	return m, "active", true, nil
}

func (f *fakeRepo) OldestActiveOwner(_ context.Context, wsID string) (wsapp.Member, bool, error) {
	var best *wsapp.Member
	for k, m := range f.members {
		if k[:len(wsID)] != wsID || k[len(wsID)] != '|' || m.Role != "owner" {
			continue
		}
		cm := m
		if best == nil || cm.CreatedAt.Before(best.CreatedAt) {
			best = &cm
		}
	}
	if best == nil {
		return wsapp.Member{}, false, nil
	}
	return *best, true, nil
}

func (f *fakeRepo) TransferOwnershipTx(_ context.Context, _ pgx.Tx, wsID, from, to string) error {
	tk := wsID + "|" + to
	tm, ok := f.members[tk]
	if !ok || tm.Role == "owner" {
		return wsapp.ErrNotFound
	}
	tm.Role = "owner"
	f.members[tk] = tm
	fk := wsID + "|" + from
	fm, ok := f.members[fk]
	if !ok || fm.Role != "owner" {
		return wsapp.ErrNotFound
	}
	fm.Role = "member"
	f.members[fk] = fm
	return nil
}

func TestTransferOwnershipRoute(t *testing.T) {
	transfer := func(t *testing.T, mux *http.ServeMux, actor, target string) *httptest.ResponseRecorder {
		t.Helper()
		var p *webx.Principal
		if actor != "" {
			p = &webx.Principal{UserID: actor}
		}
		return do(t, mux, "POST", "/api/workspaces/ws-1/transfer-ownership",
			`{"user_id":"`+target+`"}`, p)
	}

	t.Run("owner 转让成功 200：目标升 owner、原 owner 降 member", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "alice", "bob")
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if got := f.members["ws-1|bob"].Role; got != "owner" {
			t.Fatalf("bob 角色 = %s", got)
		}
		if got := f.members["ws-1|alice"].Role; got != "member" {
			t.Fatalf("alice 应降为 member, got %s", got)
		}
	})

	t.Run("非 owner（admin 角色）发起 403 E_FORBIDDEN", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "carol", "bob")
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if c := errCode(t, w); c != "E_FORBIDDEN" {
			t.Fatalf("code = %s", c)
		}
		if got := f.members["ws-1|bob"].Role; got != "member" {
			t.Fatal("被拒的转让不得改角色")
		}
	})

	t.Run("member 发起 403", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "bob", "carol")
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("转给自己 409（owner 集不变式守卫）", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "alice", "alice")
		if w.Code != http.StatusConflict {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if c := errCode(t, w); c != "E_CONFLICT" {
			t.Fatalf("code = %s", c)
		}
		if got := f.members["ws-1|alice"].Role; got != "owner" {
			t.Fatal("被拒的自转不得改角色")
		}
	})

	t.Run("目标非成员 404", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "alice", "ghost")
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("非成员发起 404（存在性保护）", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "stranger", "bob")
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("未认证 401", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := transfer(t, mux, "", "bob")
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("平台管理员且为本区非 owner 成员：豁免发起方校验，仲裁唯一 owner", func(t *testing.T) {
		mux, f := setupMux(t, workspace.WorkspaceHooks{})
		r := httptest.NewRequest("POST", "/api/workspaces/ws-1/transfer-ownership",
			strings.NewReader(`{"user_id":"bob"}`))
		r = r.WithContext(webx.WithPrincipal(r.Context(), &webx.Principal{UserID: "carol", IsPlatformAdmin: true}))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if got := f.members["ws-1|bob"].Role; got != "owner" {
			t.Fatalf("bob 角色 = %s", got)
		}
		if got := f.members["ws-1|alice"].Role; got != "member" {
			t.Fatalf("唯一 owner alice 应被仲裁为 from, got %s", got)
		}
	})
}

func TestRevokeRoutesReturn204(t *testing.T) {
	t.Run("admin revoke invitation 204", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1/invitations/inv-1", "", &webx.Principal{UserID: "carol"})
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if w.Body.Len() != 0 {
			t.Fatalf("204 must have empty body, got %s", w.Body.String())
		}
	})
	t.Run("admin revoke share-link 204", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1/share-links/link-1", "", &webx.Principal{UserID: "carol"})
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if w.Body.Len() != 0 {
			t.Fatalf("204 must have empty body, got %s", w.Body.String())
		}
	})
	t.Run("revoke 未知邀请 404", func(t *testing.T) {
		mux, _ := setupMux(t, workspace.WorkspaceHooks{})
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1/invitations/inv-x", "", &webx.Principal{UserID: "carol"})
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})
}

func TestDeleteRouteStepUpComposition(t *testing.T) {
	// The composition contract of Deps.sensitive: the permission check is
	// outermost (role denial is terminal), the step-up challenge inner
	// (recoverable). Proof: a member with a stale confirmation still gets
	// E_FORBIDDEN — if step-up ran first they would see E_REAUTH_REQUIRED.
	stepUpMux := func() *http.ServeMux {
		f := &fakeRepo{
			workspaces: map[string]wsapp.Workspace{
				"ws-1": {ID: "ws-1", Slug: "acme", Name: "Acme", PlanCode: "free"},
			},
			members: map[string]wsapp.Member{
				"ws-1|alice": {UserID: "alice", Role: "owner"},
				"ws-1|bob":   {UserID: "bob", Role: "member"},
			},
		}
		svc := wsapp.NewWorkspaceService(f, authz.New(nil, nil), nil, nil, wsapp.WorkspaceConfig{MaxPerUser: -1},
			func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) })
		mux := http.NewServeMux()
		Mount(mux, Deps{Svc: svc, Members: f, Authz: authz.New(nil, nil),
			StepUp: webx.RequireRecentAuth(15 * time.Minute)})
		return mux
	}

	t.Run("member 确认过期 → 仍是 E_FORBIDDEN（角色拒绝优先于重认证）", func(t *testing.T) {
		mux := stepUpMux()
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "",
			&webx.Principal{UserID: "bob", Source: webx.SourceSession})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if c := errCode(t, w); c != "E_FORBIDDEN" {
			t.Fatalf("code = %s, want E_FORBIDDEN", c)
		}
	})

	t.Run("owner 确认过期 → E_REAUTH_REQUIRED 携带窗口", func(t *testing.T) {
		mux := stepUpMux()
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "",
			&webx.Principal{UserID: "alice", Source: webx.SourceSession})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		var body struct {
			Code    string `json:"error"`
			Details struct {
				MaxAgeSeconds int `json:"max_age_seconds"`
			} `json:"details"`
		}
		if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Code != "E_REAUTH_REQUIRED" {
			t.Fatalf("code = %s", body.Code)
		}
		if body.Details.MaxAgeSeconds != 900 {
			t.Fatalf("max_age_seconds = %d, want 900", body.Details.MaxAgeSeconds)
		}
	})

	t.Run("owner 确认新鲜 → 204 放行", func(t *testing.T) {
		mux := stepUpMux()
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "",
			&webx.Principal{UserID: "alice", Source: webx.SourceSession,
				PasswordConfirmedAt: time.Now().Add(-time.Minute)})
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
	})

	t.Run("owner PAT 调用 → E_FORBIDDEN（机器凭据永远过不了 step-up）", func(t *testing.T) {
		mux := stepUpMux()
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1", "",
			&webx.Principal{UserID: "alice", Source: webx.SourcePAT,
				PasswordConfirmedAt: time.Now()})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if c := errCode(t, w); c != "E_FORBIDDEN" {
			t.Fatalf("code = %s, want E_FORBIDDEN", c)
		}
	})
}


func TestRoleConfigRoutes(t *testing.T) {
	newRoleMux := func() (*http.ServeMux, *fakeRepo) {
		f := &fakeRepo{
			workspaces: map[string]wsapp.Workspace{
				"ws-1": {ID: "ws-1", Slug: "acme", Name: "Acme", PlanCode: "free"},
			},
			members: map[string]wsapp.Member{
				"ws-1|alice": {UserID: "alice", Role: "owner"},
				"ws-1|carol": {UserID: "carol", Role: "admin"},
				"ws-1|bob":   {UserID: "bob", Role: "member"},
			},
			roleOverrides: map[string][]authz.Permission{},
		}
		svc := wsapp.NewWorkspaceService(f, authz.New(nil, nil), nil, nil, wsapp.WorkspaceConfig{MaxPerUser: -1},
			func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) })
		mux := http.NewServeMux()
		Mount(mux, Deps{Svc: svc, Members: f, Authz: authz.New(nil, nil),
			StepUp: webx.RequireRecentAuth(15 * time.Minute)})
		return mux, f
	}

	t.Run("owner GET 200（矩阵 + 目录含 roles:manage）", func(t *testing.T) {
		mux, _ := newRoleMux()
		w := do(t, mux, "GET", "/api/workspaces/ws-1/roles", "", &webx.Principal{UserID: "alice"})
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		var body struct {
			Items []struct {
				Role       string   `json:"role"`
				Overridden bool     `json:"overridden"`
			} `json:"items"`
			Catalog []string `json:"catalog"`
		}
		if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Items) != 2 {
			t.Fatalf("items = %+v", body.Items)
		}
		found := false
		for _, p := range body.Catalog {
			if p == "roles:manage" {
				found = true
			}
		}
		if !found {
			t.Fatalf("catalog missing roles:manage: %v", body.Catalog)
		}
	})

	t.Run("member GET 403（roles:manage 默认 owner 专属）", func(t *testing.T) {
		mux, _ := newRoleMux()
		w := do(t, mux, "GET", "/api/workspaces/ws-1/roles", "", &webx.Principal{UserID: "bob"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d", w.Code)
		}
	})

	t.Run("admin GET 403（默认角色集不给 admin roles:manage，防自授权）", func(t *testing.T) {
		mux, _ := newRoleMux()
		w := do(t, mux, "GET", "/api/workspaces/ws-1/roles", "", &webx.Principal{UserID: "carol"})
		if w.Code != http.StatusForbidden {
			t.Fatalf("status = %d", w.Code)
		}
	})

	t.Run("owner PUT 确认过期 → E_REAUTH_REQUIRED；确认新鲜 → 200 落库", func(t *testing.T) {
		mux, f := newRoleMux()
		stale := &webx.Principal{UserID: "alice", Source: webx.SourceSession}
		w := do(t, mux, "PUT", "/api/workspaces/ws-1/roles/member", `{"perms":["workspace:read"]}`, stale)
		if w.Code != http.StatusForbidden || errCode(t, w) != "E_REAUTH_REQUIRED" {
			t.Fatalf("status = %d code=%s body=%s", w.Code, errCode(t, w), w.Body.String())
		}
		if len(f.roleOverrides) != 0 {
			t.Fatal("step-up 未通过不得落库")
		}

		fresh := &webx.Principal{UserID: "alice", Source: webx.SourceSession,
			PasswordConfirmedAt: time.Now().Add(-time.Minute)}
		w = do(t, mux, "PUT", "/api/workspaces/ws-1/roles/member", `{"perms":["workspace:read","billing:manage"]}`, fresh)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		got := f.roleOverrides["ws-1|member"]
		if len(got) != 2 || got[0] != "billing:manage" || got[1] != "workspace:read" {
			t.Fatalf("override = %v", got)
		}
	})

	t.Run("owner PUT 未知权限 → 400 不落库", func(t *testing.T) {
		mux, f := newRoleMux()
		fresh := &webx.Principal{UserID: "alice", Source: webx.SourceSession,
			PasswordConfirmedAt: time.Now()}
		w := do(t, mux, "PUT", "/api/workspaces/ws-1/roles/admin", `{"perms":["nope:nope"]}`, fresh)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if len(f.roleOverrides) != 0 {
			t.Fatalf("被拒写入不得落库: %v", f.roleOverrides)
		}
	})

	t.Run("owner DELETE → 204", func(t *testing.T) {
		mux, f := newRoleMux()
		f.roleOverrides["ws-1|member"] = []authz.Permission{"workspace:read"}
		fresh := &webx.Principal{UserID: "alice", Source: webx.SourceSession,
			PasswordConfirmedAt: time.Now()}
		w := do(t, mux, "DELETE", "/api/workspaces/ws-1/roles/member", "", fresh)
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
		}
		if _, ok := f.roleOverrides["ws-1|member"]; ok {
			t.Fatal("override 未删除")
		}
	})
}
