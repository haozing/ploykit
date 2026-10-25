package webx

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"testing"
	"time"
)

// svixSign builds a whsec secret and signs the triple the way Svix senders
// do — the mirror of svixVerifyAt, written independently from the reference
// vectors in the shuijing field report.
func svixSign(t *testing.T, key []byte, msgID, timestamp string, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(msgID))
	mac.Write([]byte("."))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func svixFixture(t *testing.T) (secret string, key []byte, msgID, ts string, body []byte, sig string) {
	t.Helper()
	key = []byte("svix-test-key-16")
	secret = "whsec_" + base64.StdEncoding.EncodeToString(key)
	msgID = "msg_2Ud4hVf0t9JfLcQ"
	ts = strconv.FormatInt(time.Date(2025, 10, 25, 8, 0, 0, 0, time.UTC).Unix(), 10)
	body = []byte(`{"type":"email.bounced","data":{"email":"a@b.c"}}`)
	return secret, key, msgID, ts, body, svixSign(t, key, msgID, ts, body)
}

func at(t *testing.T, ts string) time.Time {
	t.Helper()
	tm, err := time.Parse("2006-01-02T15:04:05Z", ts)
	if err != nil {
		t.Fatal(err)
	}
	return tm
}

func TestSvixVerify(t *testing.T) {
	secret, key, msgID, ts, body, sig := svixFixture(t)
	now := at(t, "2025-10-25T08:00:00Z")

	t.Run("valid triple passes", func(t *testing.T) {
		if !svixVerifyAt(secret, msgID, ts, "v1,"+sig, body, now) {
			t.Error("valid signature rejected")
		}
	})

	t.Run("secret without whsec prefix also decodes", func(t *testing.T) {
		raw := base64.StdEncoding.EncodeToString(key)
		if !svixVerifyAt(raw, msgID, ts, "v1,"+sig, body, now) {
			t.Error("prefixless secret rejected")
		}
	})

	t.Run("tampered body rejected", func(t *testing.T) {
		if svixVerifyAt(secret, msgID, ts, "v1,"+sig, []byte(`{"type":"email.bounced","data":{"email":"evil@x.y"}}`), now) {
			t.Error("tampered body accepted")
		}
	})

	t.Run("wrong message id rejected", func(t *testing.T) {
		if svixVerifyAt(secret, "msg_other", ts, "v1,"+sig, body, now) {
			t.Error("mismatched svix-id accepted")
		}
	})

	t.Run("multi-version header any-match passes", func(t *testing.T) {
		bad := base64.StdEncoding.EncodeToString([]byte("not the mac"))
		if !svixVerifyAt(secret, msgID, ts, "v1,"+bad+" v1,"+sig, body, now) {
			t.Error("space-separated candidates with one good match rejected")
		}
	})

	t.Run("all-bad candidates rejected", func(t *testing.T) {
		bad := base64.StdEncoding.EncodeToString([]byte("not the mac"))
		if svixVerifyAt(secret, msgID, ts, "v1,"+bad, body, now) {
			t.Error("bad candidate accepted")
		}
	})

	t.Run("unknown version ignored", func(t *testing.T) {
		if svixVerifyAt(secret, msgID, ts, "v2,"+sig, body, now) {
			t.Error("non-v1 version accepted")
		}
	})

	t.Run("timestamp within tolerance passes (4 min skew)", func(t *testing.T) {
		if !svixVerifyAt(secret, msgID, ts, "v1,"+sig, body, now.Add(4*time.Minute)) {
			t.Error("skew within ±5min rejected")
		}
	})

	t.Run("stale timestamp rejected (6m40s skew)", func(t *testing.T) {
		if svixVerifyAt(secret, msgID, ts, "v1,"+sig, body, now.Add(400*time.Second)) {
			t.Error("replay outside ±5min accepted")
		}
	})

	t.Run("future timestamp rejected", func(t *testing.T) {
		if svixVerifyAt(secret, msgID, ts, "v1,"+sig, body, now.Add(-6*time.Minute)) {
			t.Error("future timestamp outside ±5min accepted")
		}
	})

	t.Run("unparseable timestamp rejected", func(t *testing.T) {
		if svixVerifyAt(secret, msgID, "not-a-number", "v1,"+sig, body, now) {
			t.Error("garbage timestamp accepted")
		}
	})

	t.Run("missing pieces rejected", func(t *testing.T) {
		if svixVerifyAt("", msgID, ts, "v1,"+sig, body, now) {
			t.Error("empty secret accepted")
		}
		if svixVerifyAt(secret, "", ts, "v1,"+sig, body, now) {
			t.Error("empty svix-id accepted")
		}
		if svixVerifyAt(secret, msgID, ts, "", body, now) {
			t.Error("empty signature accepted")
		}
		if svixVerifyAt("whsec_!!!not-base64!!!", msgID, ts, "v1,"+sig, body, now) {
			t.Error("undecodable secret accepted")
		}
	})
}

func TestSvixHeaders(t *testing.T) {
	r, err := http.NewRequest(http.MethodPost, "/hooks/resend", nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("svix-id", "msg_1")
	r.Header.Set("svix-timestamp", "1761388800")
	r.Header.Set("svix-signature", "v1,abc")

	id, ts, sig := SvixHeaders(r)
	if id != "msg_1" || ts != "1761388800" || sig != "v1,abc" {
		t.Fatalf("got (%q,%q,%q)", id, ts, sig)
	}

	r2, err := http.NewRequest(http.MethodPost, "/hooks/resend", nil)
	if err != nil {
		t.Fatal(err)
	}
	if id, ts, sig := SvixHeaders(r2); id != "" || ts != "" || sig != "" {
		t.Fatalf("missing headers should be empty strings, got (%q,%q,%q)", id, ts, sig)
	}
}
