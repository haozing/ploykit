package app

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
)

const EnvAllowPrivateTarget = "WEBHOOK_ALLOW_PRIVATE_TARGET"

func envAllowsPrivateTarget() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(EnvAllowPrivateTarget))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func (s *WebhookService) validateTarget(ctx context.Context, rawURL string) error {
	if s.targetGuard != nil {
		return s.targetGuard.ValidateURL(ctx, rawURL)
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid webhook url: %v", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("webhook url scheme must be http or https, got %q", u.Scheme)
	}
	if u.Hostname() == "" {
		return fmt.Errorf("webhook url host is required")
	}
	return nil
}
