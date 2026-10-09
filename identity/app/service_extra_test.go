package app_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/haozing/ploykit/identity/app"
	"github.com/haozing/ploykit/identity/domain"
	"github.com/haozing/ploykit/platform/webx"
)

type extraRepo struct {
	app.Repo
	pats       map[string][]app.PAT
	revoked    []string
	revokeMiss map[string]bool
	tokensOut  []string
	sessions   []app.SessionInfo
	allRevoked []string
	updated    [3]string
}

func newExtraRepo() *extraRepo {
	return &extraRepo{pats: map[string][]app.PAT{}}
}

func (r *extraRepo) CreatePAT(_ context.Context, userID, name, hash, prefix string, expiresAt *time.Time, scope *webx.CredentialScope) (app.PAT, error) {
	pat := app.PAT{ID: "pat-" + name, Name: name, Prefix: prefix, ExpiresAt: expiresAt, CreatedAt: frozen, Scope: scope}
	r.pats[userID] = append(r.pats[userID], pat)
	return pat, nil
}

func (r *extraRepo) ListPATs(_ context.Context, userID string) ([]app.PAT, error) {
	return r.pats[userID], nil
}

func (r *extraRepo) RevokePAT(_ context.Context, _, patID string, _ time.Time) error {
	if r.revokeMiss[patID] {
		return app.ErrNotFound
	}
	r.revoked = append(r.revoked, patID)
	return nil
}

func (r *extraRepo) UpdateProfile(_ context.Context, id, displayName, avatarURL string) (app.User, error) {
	r.updated = [3]string{id, displayName, avatarURL}
	return app.User{ID: id, DisplayName: displayName, AvatarURL: avatarURL}, nil
}

func (r *extraRepo) RevokeSession(_ context.Context, token string) error {
	r.tokensOut = append(r.tokensOut, token)
	return nil
}

func (r *extraRepo) ListUserSessions(_ context.Context, userID string) ([]app.SessionInfo, error) {
	return r.sessions, nil
}

func (r *extraRepo) RevokeAllUserSessions(_ context.Context, userID string) error {
	r.allRevoked = append(r.allRevoked, userID)
	return nil
}

func (r *extraRepo) RevokeUserSessionByID(_ context.Context, _, _ string, _ time.Time) error {
	return app.ErrNotFound
}

func newTokenSvc(r *extraRepo, aud *fakeAuditor) *app.TokenService {
	return app.NewTokenService(r, aud, func() time.Time { return frozen })
}

func newSessSvc(r *extraRepo) *app.SessionService {
	return app.NewSessionService(r, nil, app.SessionConfig{}, time.Hour, 0, func() time.Time { return frozen })
}

func TestCreatePAT_UTIA06(t *testing.T) {
	r := newExtraRepo()
	svc := newTokenSvc(r, &fakeAuditor{})
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	_, _, err := svc.CreatePAT(context.Background(), p, "", time.Hour, nil)
	var we *webx.Error
	if !errors.As(err, &we) || we.Status != 400 {
		t.Fatalf("empty name: got %v", err)
	}

	_, _, err = svc.CreatePAT(context.Background(), p, strings.Repeat("a", 65), time.Hour, nil)
	if !errors.As(err, &we) || we.Status != 400 {
		t.Fatalf("65-char name: got %v", err)
	}

	_, _, err = svc.CreatePAT(context.Background(), p, strings.Repeat("a", 64), time.Hour, nil)
	if err != nil {
		t.Fatalf("64-char name: %v", err)
	}

	pat, token, err := svc.CreatePAT(context.Background(), p, "ci", 7*24*time.Hour, nil)
	if err != nil {
		t.Fatalf("ok path: %v", err)
	}
	if !domain.IsPATFormat("", token) {
		t.Errorf("明文令牌格式: %q", token)
	}
	if pat.Prefix != token[:8] {
		t.Errorf("展示前缀应取令牌前 8 位: %q vs %q", pat.Prefix, token[:8])
	}
	if pat.ExpiresAt == nil || !pat.ExpiresAt.Equal(frozen.Add(7*24*time.Hour)) {
		t.Errorf("ExpiresAt: %v", pat.ExpiresAt)
	}

	pat2, _, err := svc.CreatePAT(context.Background(), p, "forever", 0, nil)
	if err != nil {
		t.Fatalf("ttl=0: %v", err)
	}
	if pat2.ExpiresAt != nil {
		t.Errorf("ttl=0 应无过期: %v", pat2.ExpiresAt)
	}
}

func TestCreatePATCustomPrefix_N4(t *testing.T) {
	r := newExtraRepo()
	svc := newTokenSvc(r, &fakeAuditor{}).WithPATPrefix("ork_")
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	pat, token, err := svc.CreatePAT(context.Background(), p, "mcp", 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(token, "ork_") || len(token) != len("ork_")+40 {
		t.Errorf("自定义前缀令牌形态: %q", token)
	}
	if !domain.IsPATFormat("ork_", token) {
		t.Errorf("应过同前缀形态闸门: %q", token)
	}
	if pat.Prefix != token[:8] {
		t.Errorf("展示前缀应取令牌前 8 位: %q vs %q", pat.Prefix, token[:8])
	}
	if got := r.pats["u1"][0].Prefix; got != token[:8] {
		t.Errorf("仓储收到的展示前缀: %q want %q", got, token[:8])
	}

	defSvc := newTokenSvc(newExtraRepo(), &fakeAuditor{})
	_, defToken, err := defSvc.CreatePAT(context.Background(), p, "d", 0, nil)
	if err != nil || !domain.IsPATFormat("", defToken) {
		t.Errorf("默认前缀令牌: %q err=%v", defToken, err)
	}
}

func TestCreatePATWithScope_C3(t *testing.T) {
	r := newExtraRepo()
	svc := newTokenSvc(r, &fakeAuditor{})
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}
	scope := &webx.CredentialScope{WorkspaceIDs: []string{"ws-1"}, Permissions: []string{"tasks:*"}}

	pat, _, err := svc.CreatePAT(context.Background(), p, "ci", 0, scope)
	if err != nil {
		t.Fatal(err)
	}
	if pat.Scope != scope {
		t.Fatalf("返回元数据应携带 scope: %+v", pat.Scope)
	}
	if got := r.pats["u1"][0].Scope; got != scope {
		t.Fatalf("仓储应收到 scope: %+v", got)
	}
}

func TestListAndRevokePAT_UTIA07(t *testing.T) {
	r := newExtraRepo()
	aud := &fakeAuditor{}
	svc := newTokenSvc(r, aud)
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	if _, _, err := svc.CreatePAT(context.Background(), p, "a", 0, nil); err != nil {
		t.Fatal(err)
	}
	pats, err := svc.ListPATs(context.Background(), p)
	if err != nil || len(pats) != 1 {
		t.Fatalf("ListPATs: %v n=%d", err, len(pats))
	}
	if !containsStr(aud.actions, "pat.create") {
		t.Errorf("pat.create 审计缺失: %v", aud.actions)
	}
	if err := svc.RevokePAT(context.Background(), p, pats[0].ID); err != nil {
		t.Fatalf("RevokePAT: %v", err)
	}
	if len(r.revoked) != 1 || r.revoked[0] != pats[0].ID {
		t.Errorf("吊销未透传: %v", r.revoked)
	}
	if !containsStr(aud.actions, "pat.revoke") {
		t.Errorf("pat.revoke 审计缺失: %v", aud.actions)
	}
}

func TestRevokePATNotFoundMaps404_SECV2(t *testing.T) {
	r := newExtraRepo()
	r.revokeMiss = map[string]bool{"pat-other": true}
	aud := &fakeAuditor{}
	svc := newTokenSvc(r, aud)
	p := &webx.Principal{UserID: "u1", Source: webx.SourceSession}

	err := svc.RevokePAT(context.Background(), p, "pat-other")
	var we *webx.Error
	if !errors.As(err, &we) || we.Status != http.StatusNotFound {
		t.Fatalf("跨用户/未知 patID: got %v want 404", err)
	}
	if len(r.revoked) != 0 {
		t.Errorf("不应透传吊销: %v", r.revoked)
	}
	if containsStr(aud.actions, "pat.revoke") {
		t.Error("吊销失败不应写 pat.revoke 审计")
	}

	if err := svc.RevokePAT(context.Background(), p, "pat-mine"); err != nil {
		t.Fatalf("本人 patID: %v", err)
	}
	if !containsStr(aud.actions, "pat.revoke") {
		t.Error("成功吊销应写 pat.revoke 审计")
	}
}

func TestUpdateProfile_UTIA02(t *testing.T) {
	r := newExtraRepo()
	svc := newSessSvc(r)
	p := &webx.Principal{UserID: "u1"}

	_, err := svc.UpdateProfile(context.Background(), p, "", "https://cdn.example.com/a.png")
	var we *webx.Error
	if !errors.As(err, &we) || we.Status != 400 {
		t.Fatalf("empty name: got %v", err)
	}
	u, err := svc.UpdateProfile(context.Background(), p, "Alice", "https://cdn.example.com/a.png")
	if err != nil {
		t.Fatalf("ok: %v", err)
	}
	if u.DisplayName != "Alice" || r.updated != [3]string{"u1", "Alice", "https://cdn.example.com/a.png"} {
		t.Errorf("UpdateProfile 未透传: u=%+v repo=%v", u, r.updated)
	}
}

func TestUpdateProfileDisplayNameLimit_FT28(t *testing.T) {
	r := newExtraRepo()
	svc := newSessSvc(r)
	p := &webx.Principal{UserID: "u1"}

	for name, dn := range map[string]string{
		"101 rune 越界": strings.Repeat("a", 101),
		"1.2MB 超大值":   strings.Repeat("x", 1_200_000),
		"纯空白":         "  \n ",
	} {
		_, err := svc.UpdateProfile(context.Background(), p, dn, "")
		var we *webx.Error
		if !errors.As(err, &we) || we.Status != 400 {
			t.Fatalf("%s: got %v want 400", name, err)
		}
		if we.Code != webx.CodeValidation || !strings.Contains(we.Message, "display_name") {
			t.Errorf("%s: 错误应指明 display_name 字段: %+v", name, we)
		}
	}
	if r.updated != [3]string{} {
		t.Errorf("越界请求不应触达仓储: %v", r.updated)
	}

	u, err := svc.UpdateProfile(context.Background(), p, "  "+strings.Repeat("名", 100)+"  ", "")
	if err != nil {
		t.Fatalf("100 rune 边界应放行: %v", err)
	}
	if u.DisplayName != strings.Repeat("名", 100) {
		t.Errorf("trim 归一失败: %q", firstRunes(u.DisplayName, 12))
	}
}

func TestUpdateProfileAvatarURL_B1(t *testing.T) {
	r := newExtraRepo()
	svc := newSessSvc(r)
	p := &webx.Principal{UserID: "u1"}

	for name, avatar := range map[string]string{
		"javascript 伪协议": "javascript:alert(1)",
		"data 伪协议":       "data:image/png;base64,AAAA",
		"ftp 等非 http(s)": "ftp://example.com/a.png",
		"3000 字符超长":      "https://" + strings.Repeat("a", 3000),
		"2048 字节越界一格":    "https://" + strings.Repeat("a", domain.AvatarURLMaxLen-len("https://")+1),
	} {
		_, err := svc.UpdateProfile(context.Background(), p, "Alice", avatar)
		var we *webx.Error
		if !errors.As(err, &we) || we.Status != 400 {
			t.Fatalf("%s: got %v want 400", name, err)
		}
		if we.Code != webx.CodeValidation || !strings.Contains(we.Message, "avatar_url") {
			t.Errorf("%s: 错误应指明 avatar_url 字段: %+v", name, we)
		}
	}
	if r.updated != [3]string{} {
		t.Errorf("非法 avatar 不得触达仓储: %v", r.updated)
	}

	cases := []struct {
		name   string
		avatar string
		want   string
	}{
		{"空串清除", "", ""},
		{"纯空白归一为清除", "  \n ", ""},
		{"https", "https://cdn.example.com/a.png", "https://cdn.example.com/a.png"},
		{"http", "http://cdn.example.com/a.png", "http://cdn.example.com/a.png"},
		{"2048 字节边界放行", "https://" + strings.Repeat("a", domain.AvatarURLMaxLen-len("https://")), "https://" + strings.Repeat("a", domain.AvatarURLMaxLen-len("https://"))},
	}
	for _, c := range cases {
		u, err := svc.UpdateProfile(context.Background(), p, "Alice", c.avatar)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if u.AvatarURL != c.want || r.updated != [3]string{"u1", "Alice", c.want} {
			t.Errorf("%s: 归一/透传不符: u=%+v repo=%v", c.name, u, r.updated)
		}
	}
}

func firstRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func TestLogout_UTIA03(t *testing.T) {
	r := newExtraRepo()
	svc := newSessSvc(r)
	if err := svc.Logout(context.Background(), "tok-1"); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if len(r.tokensOut) != 1 || r.tokensOut[0] != "tok-1" {
		t.Errorf("token 未透传: %v", r.tokensOut)
	}
}

func TestListAndRevokeAllSessions_UTIA04(t *testing.T) {
	r := newExtraRepo()
	r.sessions = []app.SessionInfo{{ID: "s1", UserAgent: "ua"}}
	svc := newSessSvc(r)
	p := &webx.Principal{UserID: "u1"}

	sessions, err := svc.ListSessions(context.Background(), p)
	if err != nil || len(sessions) != 1 || sessions[0].ID != "s1" {
		t.Fatalf("ListSessions: %v %v", err, sessions)
	}
	if err := svc.RevokeAllSessions(context.Background(), p); err != nil {
		t.Fatalf("RevokeAllSessions: %v", err)
	}
	if len(r.allRevoked) != 1 || r.allRevoked[0] != "u1" {
		t.Errorf("全吊销未按 userID 透传: %v", r.allRevoked)
	}
}

func TestRevokeSessionByID_UTIA05(t *testing.T) {
	r := newExtraRepo()
	svc := newSessSvc(r)
	p := &webx.Principal{UserID: "u1", SessionID: "s1", Source: webx.SourceSession}

	if err := svc.RevokeSessionByID(context.Background(), p, "s2"); err == nil {
		t.Fatal("未知会话应报错")
	} else {
		var we *webx.Error
		if !errors.As(err, &we) || we.Status != 404 {
			t.Fatalf("want 404, got %v", err)
		}
	}
	_ = r
}

func containsStr(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
