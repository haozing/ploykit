package mailtpl

import (
	"strings"
	"testing"
)

func TestCompileZeroValueFallsBackToDefaults(t *testing.T) {
	c, err := Compile(Templates{})
	if err != nil {
		t.Fatal(err)
	}
	subject, err := Render(c.LoginCodeSubject, LoginCodeData{Code: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	body, err := Render(c.LoginCodeBody, LoginCodeData{Code: "123456"})
	if err != nil {
		t.Fatal(err)
	}
	if subject != "你的登录验证码" || !strings.Contains(body, "123456") {
		t.Fatalf("zero-value templates must reproduce the legacy copy, got %q / %q", subject, body)
	}
}

func TestCompileCustomPieceOverridesDefault(t *testing.T) {
	c, err := Compile(Templates{LoginCode: Template{Subject: "Code {{.Code}}"}})
	if err != nil {
		t.Fatal(err)
	}
	subject, err := Render(c.LoginCodeSubject, LoginCodeData{Code: "99"})
	if err != nil {
		t.Fatal(err)
	}
	if subject != "Code 99" {
		t.Fatalf("custom subject not used: %q", subject)
	}
	body, err := Render(c.LoginCodeBody, LoginCodeData{Code: "99"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "若非本人操作") {
		t.Fatalf("empty custom body must fall back to the default, got %q", body)
	}
}

func TestCompileParseErrorNamesThePiece(t *testing.T) {
	_, err := Compile(Templates{Invite: Template{Subject: "{{.Workspace"}})
	if err == nil || !strings.Contains(err.Error(), "invite.subject") {
		t.Fatalf("parse error must name the piece, got %v", err)
	}
}

func TestRenderWrongFieldErrors(t *testing.T) {
	c, err := Compile(Templates{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Render(c.LoginCodeBody, LinkData{Link: "x"}); err == nil {
		t.Fatal("referencing a field outside the group's data must fail the render")
	}
}
