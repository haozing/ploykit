package webx

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
)

func TestAppErrConstructors_UTWX01(t *testing.T) {
	cases := []struct {
		name   string
		got    *Error
		status int
		code   string
	}{
		{"validation", NewValidation("bad input"), 400, CodeValidation},
		{"unauthenticated", NewUnauthenticated("login"), 401, CodeUnauthenticated},
		{"forbidden", NewForbidden("no"), 403, CodeForbidden},
		{"notfound", NewNotFound("gone"), 404, CodeNotFound},
		{"conflict", NewConflict("dup"), 409, CodeConflict},
		{"quota", NewQuotaExceeded("limit"), 402, CodeQuotaExceeded},
		{"ratelimited", NewRateLimited("slow"), 429, CodeRateLimited},
	}
	for _, c := range cases {
		if c.got.Status != c.status || c.got.Code != c.code {
			t.Errorf("%s: got (%d,%s) want (%d,%s)", c.name, c.got.Status, c.got.Code, c.status, c.code)
		}
		if c.got.Error() != c.got.Message {
			t.Errorf("%s: Error() 应返回 Message", c.name)
		}
	}

	e := NewError(418, "E_TEAPOT", "short and stout")
	if e.Status != 418 || e.Code != "E_TEAPOT" {
		t.Errorf("NewError 自定义字段未生效: %+v", e)
	}
}

func TestWriteErr_UTWX02(t *testing.T) {

	rec := httptest.NewRecorder()
	WriteErr(rec, NewConflict("slug taken"))
	if rec.Code != 409 {
		t.Errorf("status=%d want 409", rec.Code)
	}
	var body ErrorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("响应应为 JSON 信封: %v", err)
	}
	if body.Code != CodeConflict || body.Message != "slug taken" {
		t.Errorf("body=%+v", body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type=%q", ct)
	}

	rec2 := httptest.NewRecorder()
	WriteErr(rec2, errors.New("secret db detail"))
	if rec2.Code != 500 {
		t.Errorf("status=%d want 500", rec2.Code)
	}
	var body2 ErrorBody
	_ = json.Unmarshal(rec2.Body.Bytes(), &body2)
	if body2.Code != CodeInternal || body2.Message == "secret db detail" {
		t.Errorf("未知错误应返回 E_INTERNAL 且不泄露原始信息: %+v", body2)
	}
}

func TestRespondHelpers_UTWX03(t *testing.T) {
	cases := []struct {
		name   string
		call   func(w *httptest.ResponseRecorder)
		status int
		code   string
	}{
		{"forbidden", func(w *httptest.ResponseRecorder) { ErrForbidden(w, "no") }, 403, CodeForbidden},
		{"notfound", func(w *httptest.ResponseRecorder) { ErrNotFound(w, "x") }, 404, CodeNotFound},
		{"validation", func(w *httptest.ResponseRecorder) { ErrValidation(w, "x") }, 400, CodeValidation},
		{"conflict", func(w *httptest.ResponseRecorder) { ErrConflict(w, "x") }, 409, CodeConflict},
		{"unauth", func(w *httptest.ResponseRecorder) { ErrUnauthenticated(w, "x") }, 401, CodeUnauthenticated},
		{"timeout", func(w *httptest.ResponseRecorder) { ErrTimeout(w) }, 504, CodeTimeout},
		{"payload", func(w *httptest.ResponseRecorder) { ErrPayloadTooLarge(w, "too big") }, 413, CodePayloadTooLarge},
		{"internal", func(w *httptest.ResponseRecorder) { ErrInternal(w) }, 500, CodeInternal},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		c.call(rec)
		if rec.Code != c.status {
			t.Errorf("%s: status=%d want %d", c.name, rec.Code, c.status)
		}
		var body ErrorBody
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Code != c.code {
			t.Errorf("%s: code=%s want %s", c.name, body.Code, c.code)
		}
	}
}

func TestTokenHash_UTWX04(t *testing.T) {
	tok, err := MintToken()
	if err != nil {
		t.Fatalf("MintToken: %v", err)
	}
	if len(tok) != 64 {
		t.Errorf("token len=%d want 64", len(tok))
	}
	tok2, _ := MintToken()
	if tok == tok2 {
		t.Error("两次生成不应相同")
	}
	if HashToken(tok) != HashToken(tok) || len(HashToken(tok)) != 64 {
		t.Error("HashToken 应确定性输出 64 hex")
	}
	if HashToken(tok) == HashToken(tok+"x") {
		t.Error("不同输入不应同哈希")
	}

	if HashIP("1.2.3.4", "s1") == HashIP("1.2.3.4", "s2") {
		t.Error("不同 salt 应产生不同 IP 指纹")
	}
	if HashIP("1.2.3.4", "s1") == HashIP("5.6.7.8", "s1") {
		t.Error("不同 IP 不应同指纹")
	}
	if HashIP("1.2.3.4", "s1") != HashIP("1.2.3.4", "s1") {
		t.Error("同输入应同指纹")
	}
}
