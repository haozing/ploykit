package egressx

import (
	"context"
	"testing"
)

func TestHTTPWithinExtraAllow(t *testing.T) {
	g, err := NewGuard([]string{"10.0.0.0/8", "192.168.5.0/24"})
	if err != nil {
		t.Fatal(err)
	}
	gNoExtra := DefaultGuard()
	ctx := context.Background()

	tests := []struct {
		name string
		g    *Guard
		url  string
		ok   bool
	}{
		{"exception-range IP literal http allowed", g, "http://10.1.2.3:8080/hook", true},
		{"the second exception-range literal allowed", g, "http://192.168.5.9/hook", true},
		{"private IP outside exceptions rejected", g, "http://192.168.99.9/hook", false},
		{"public IP http rejected", g, "http://8.8.8.8/hook", false},
		{"loopback rejected when not in the exceptions", g, "http://127.0.0.1:9999/hook", false},
		{"http without configured exceptions uniformly rejected", gNoExtra, "http://10.1.2.3/hook", false},
		{"https behavior unchanged (exception ranges)", g, "https://10.1.2.3/hook", true},
		{"localhost literal rejected (non-IP form goes through resolution)", g, "http://localhost/hook", false},
		{"non-http/https schemes still rejected", g, "ftp://10.1.2.3/hook", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.g.ValidateURL(ctx, tt.url)
			if tt.ok && err != nil {
				t.Fatalf("ValidateURL(%q) should not error: %v", tt.url, err)
			}
			if !tt.ok && err == nil {
				t.Fatalf("ValidateURL(%q) should error", tt.url)
			}
		})
	}
}
