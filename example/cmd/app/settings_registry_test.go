package main

// Product-registered settings keys, end to end against a real database
// (shuijing batch 2026-10-25): the generic admin PUT accepts a registered
// key, validates through the KeySpec, seals the sensitive one at rest
// (verified on the raw site_settings row, not through the API), and the list
// response merges it with masked read-back — the whole loop a product gets
// from settings.RegisterKeys with zero endpoints of its own.

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/sealx"
	"github.com/haozing/ploykit/settings"
	settingshttp "github.com/haozing/ploykit/settings/adapters/http"
)

func registryTestStore(t *testing.T, pool *pgxpool.Pool) *settings.Store {
	t.Helper()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	secrets, err := sealx.NewSecrets(key)
	require.NoError(t, err)
	s := settings.NewStore(pool).WithSealer(secrets)
	require.NoError(t, s.RegisterKeys(
		settings.KeySpec{
			Key:       "resend_api_key",
			Sensitive: true,
			Env:       "RESEND_API_KEY",
			Validate: func(v string) error {
				if v != "" && !strings.HasPrefix(v, "re_") {
					return errBadResendPrefix
				}
				return nil
			},
		},
		settings.KeySpec{
			Key: "resend_from",
			Env: "RESEND_FROM",
			Validate: func(v string) error {
				if v == "" {
					return nil
				}
				if !strings.Contains(v, "@") {
					return errBadFrom
				}
				return nil
			},
		},
	))
	return s
}

var errBadResendPrefix = &staticErr{"resend_api_key 必须以 re_ 开头"}
var errBadFrom = &staticErr{"resend_from 必须是合法邮箱地址"}

type staticErr struct{ msg string }

func (e *staticErr) Error() string { return e.msg }

func TestRegisteredKeysFullLoop(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	store := registryTestStore(t, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM site_settings WHERE key IN ('resend_api_key', 'resend_from')`)
	})

	mux := http.NewServeMux()
	settingshttp.MountAdmin(mux, settingshttp.AdminDeps{
		Store:  store,
		Guard:  func(next http.Handler) http.Handler { return next },
		Mailer: nil,
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	put := func(key, value string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(http.MethodPut, "/api/admin/settings/"+key,
			strings.NewReader(`{"value":`+jsonString(value)+`}`))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	t.Run("非法值被 spec Validate 拒绝", func(t *testing.T) {
		assert.Equal(t, http.StatusBadRequest, put("resend_api_key", "not-re").Code)
		assert.Equal(t, http.StatusBadRequest, put("resend_from", "no-at-sign").Code)
	})

	t.Run("合法写入：敏感键掩码回显 + 原文密封落库", func(t *testing.T) {
		w := put("resend_api_key", "re_live_abc")
		require.Equal(t, http.StatusOK, w.Code)
		var resp map[string]string
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		assert.Equal(t, "******", resp["value"], "敏感键响应体只回掩码")

		var raw string
		require.NoError(t, pool.QueryRow(context.Background(),
			`SELECT value FROM site_settings WHERE key = 'resend_api_key'`).Scan(&raw))
		assert.True(t, strings.HasPrefix(raw, sealx.SealedPrefix),
			"落库必须是密封串，实际前缀 %q", raw[:min(12, len(raw))])
		assert.NotContains(t, raw, "re_live_abc", "密文不得包含明文")
	})

	t.Run("普通注册键明文落库 + 列表合并", func(t *testing.T) {
		w := put("resend_from", "no-reply@example.com")
		require.Equal(t, http.StatusOK, w.Code)

		r := httptest.NewRequest(http.MethodGet, "/api/admin/settings", nil)
		rw := httptest.NewRecorder()
		mux.ServeHTTP(rw, r)
		require.Equal(t, http.StatusOK, rw.Code)

		var list struct {
			Items        map[string]string `json:"items"`
			Effective    map[string]string `json:"effective"`
			Defaults     map[string]string `json:"defaults"`
			Descriptions map[string]string `json:"descriptions"`
		}
		require.NoError(t, json.Unmarshal(rw.Body.Bytes(), &list))
		assert.Equal(t, "no-reply@example.com", list.Effective["resend_from"])
		assert.Equal(t, "no-reply@example.com", list.Items["resend_from"])
		assert.Equal(t, "******", list.Effective["resend_api_key"], "敏感键 effective 掩码")
		assert.Equal(t, "******", list.Items["resend_api_key"], "敏感键 items（密封串）也掩码")
		assert.Contains(t, list.Descriptions, "resend_api_key", "注册键描述随信封下发")
	})

	t.Run("掩码回显 = 不修改（未触碰存储）", func(t *testing.T) {
		w := put("resend_api_key", "******")
		require.Equal(t, http.StatusOK, w.Code)
		var raw string
		require.NoError(t, pool.QueryRow(context.Background(),
			`SELECT value FROM site_settings WHERE key = 'resend_api_key'`).Scan(&raw))
		assert.True(t, strings.HasPrefix(raw, sealx.SealedPrefix), "掩码提交不得改写密文")
	})

	t.Run("Effective 解封回明文（服务端读回）", func(t *testing.T) {
		eff, err := store.Effective(context.Background())
		require.NoError(t, err)
		assert.Equal(t, "re_live_abc", eff["resend_api_key"], "服务端 Effective 解封敏感注册键")
	})
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
