package waffo

import (
	"log/slog"
	"os"
	"testing"
)

// 与真实后台密钥的一次性对账(hermetic 套件默认 skip)。手动:
//
//	set -a && source .env.local && set +a && \
//	go test ./billing/adapters/waffo -run TestLiveEnvKey -v
//
// 用后台下发的私钥/公钥各解析一遍,确认 env 形态(单行 \n 转义)能被
// normalizePEM 归一,且五件套齐备时 ChannelConfig 报 webhook 已配置。
func TestLiveEnvKey(t *testing.T) {
	if os.Getenv("WAFFO_PRIVATE_KEY") == "" || os.Getenv("WAFFO_WEBHOOK_PUBLIC_KEY") == "" {
		t.Skip("live waffo env not set")
	}
	pub, err := parsePublicKey(os.Getenv("WAFFO_WEBHOOK_PUBLIC_KEY"))
	if err != nil {
		t.Fatalf("webhook public key: %v", err)
	}
	if pub.N.BitLen() != 2048 {
		t.Fatalf("webhook public key bitlen = %d, want 2048", pub.N.BitLen())
	}
	ch, err := FromEnv(os.Getenv, slog.New(slog.NewTextHandler(os.Stderr, nil)), false)
	if err != nil {
		t.Fatalf("FromEnv: %v", err)
	}
	live, ok := ch.(*Channel)
	if !ok {
		t.Fatalf("channel not built from live env, got %T", ch)
	}
	if cc := live.ChannelConfig(); !cc.Configured || !cc.WebhookConfigured {
		t.Fatalf("channel config = %+v, want both configured", cc)
	}
}
