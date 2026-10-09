package egressx

import (
	"context"
	"net/netip"
	"strings"
	"testing"
)

func TestZonedIPv6Rejected_EG1(t *testing.T) {
	g := DefaultGuard()

	for _, raw := range []string{
		"https://[fe80::1%25eth0]:8080/",
		"https://[fe80::42%25eth1]/path",
		"https://[::1%25lo]/",
	} {
		err := g.ValidateURL(context.Background(), raw)
		if err == nil || !strings.Contains(err.Error(), "private") {
			t.Errorf("ValidateURL(%q) = %v, want private-address rejection", raw, err)
		}
	}

	for _, s := range []string{"fe80::1%eth0", "::1%lo"} {
		a, err := netip.ParseAddr(s)
		if err != nil {
			t.Fatalf("ParseAddr(%q): %v", s, err)
		}
		if err := g.checkIP(a, "dial-test"); err == nil {
			t.Errorf("checkIP(%q) = nil, want rejection", s)
		}
	}

	pub := mustAddr(t, "8.8.8.8")
	if err := g.checkIP(pub, "public"); err != nil {
		t.Errorf("checkIP(public) = %v, want nil", err)
	}
}

func mustAddr(t *testing.T, s string) netip.Addr {
	t.Helper()
	a, err := netip.ParseAddr(s)
	if err != nil {
		t.Fatalf("ParseAddr(%q): %v", s, err)
	}
	return a
}
