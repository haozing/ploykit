package egressx

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"net/url"
)

var blockedPrivate = []netip.Prefix{

	mustPrefix("0.0.0.0/8"),
	mustPrefix("10.0.0.0/8"),
	mustPrefix("100.64.0.0/10"),
	mustPrefix("127.0.0.0/8"),
	mustPrefix("169.254.0.0/16"),
	mustPrefix("172.16.0.0/12"),
	mustPrefix("192.0.0.0/24"),
	mustPrefix("192.0.2.0/24"),
	mustPrefix("192.168.0.0/16"),
	mustPrefix("198.18.0.0/15"),
	mustPrefix("198.51.100.0/24"),
	mustPrefix("203.0.113.0/24"),
	mustPrefix("224.0.0.0/4"),
	mustPrefix("240.0.0.0/4"),
	mustPrefix("255.255.255.255/32"),

	mustPrefix("::/128"),
	mustPrefix("::1/128"),
	mustPrefix("64:ff9b:1::/48"),
	mustPrefix("100::/64"),
	mustPrefix("100:0:0:1::/64"),
	mustPrefix("2001::/32"),
	mustPrefix("2001:2::/48"),
	mustPrefix("2001:10::/28"),
	mustPrefix("2001:20::/28"),
	mustPrefix("2001:db8::/32"),
	mustPrefix("2002::/16"),
	mustPrefix("3fff::/20"),
	mustPrefix("5f00::/16"),
	mustPrefix("fc00::/7"),
	mustPrefix("fe80::/10"),
	mustPrefix("ff00::/8"),
}

var nat64WellKnown = mustPrefix("64:ff9b::/96")

func mustPrefix(s string) netip.Prefix {
	p, err := netip.ParsePrefix(s)
	if err != nil {
		panic("egressx: invalid built-in CIDR " + s)
	}
	return p
}

func BlockedCIDRs() []string { return prefixStrings(blockedPrivate) }

func PrivateAllowCIDRs() []string { return prefixStrings(blockedPrivate) }

func prefixStrings(ps []netip.Prefix) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.String()
	}
	return out
}

type Guard struct {
	extraAllow []netip.Prefix

	resolver *net.Resolver
}

func NewGuard(extraAllowCIDRs []string) (*Guard, error) {
	return newGuard(extraAllowCIDRs, nil)
}

func newGuard(extraAllowCIDRs []string, resolver *net.Resolver) (*Guard, error) {
	g := &Guard{resolver: resolver}
	for _, c := range extraAllowCIDRs {
		p, err := netip.ParsePrefix(c)
		if err != nil {
			return nil, fmt.Errorf("egressx: ENGINE_EGRESS_EXTRA_ALLOW_CIDRS invalid CIDR %q: %w", c, err)
		}
		g.extraAllow = append(g.extraAllow, p)
	}
	return g, nil
}

func (g *Guard) lookup(ctx context.Context, host string) ([]net.IPAddr, error) {
	r := g.resolver
	if r == nil {
		r = net.DefaultResolver
	}
	return r.LookupIPAddr(ctx, host)
}

func DefaultGuard() *Guard { return &Guard{} }

func (g *Guard) ValidateURL(ctx context.Context, raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("egress: URL parse failed: %w", err)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("egress: outbound target missing host")
	}
	switch u.Scheme {
	case "https":
	case "http":
		return g.httpWithinExtraAllow(ctx, host)
	default:
		return fmt.Errorf("egress: outbound target must be HTTPS (got %q)", u.Scheme)
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		return g.checkIP(ip.Unmap(), host)
	}
	addrs, err := g.lookup(ctx, host)
	if err != nil || len(addrs) == 0 {

		return fmt.Errorf("egress: https target %q could not be resolved (temporarily unresolvable, fail-closed)", host)
	}
	for _, a := range addrs {
		ip, ok := netip.AddrFromSlice(a.IP)
		if !ok {
			return fmt.Errorf("egress: %q resolved to an invalid address %s", host, a.IP)
		}
		if err := g.checkIP(ip.Unmap(), host); err != nil {
			return err
		}
	}
	return nil
}

func (g *Guard) httpWithinExtraAllow(ctx context.Context, host string) error {
	contains := func(a netip.Addr) bool {
		for _, p := range g.extraAllow {
			if p.Contains(a) {
				return true
			}
		}
		return false
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		if contains(ip.Unmap()) {
			return nil
		}

		return fmt.Errorf("egress: plaintext http target %s is not in the egress-policy exception ranges — use a public https endpoint (plaintext http is restricted to operator-allowlisted ranges)", host)
	}
	addrs, err := g.lookup(ctx, host)
	if err != nil || len(addrs) == 0 {
		return fmt.Errorf("egress: http target %q could not be resolved (fail-closed)", host)
	}
	for _, a := range addrs {
		ip, ok := netip.AddrFromSlice(a.IP)
		if !ok || !contains(ip.Unmap()) {
			return fmt.Errorf("egress: plaintext http target %q resolves to %s outside the egress-policy exception ranges — use a public https endpoint (plaintext http is restricted to operator-allowlisted ranges)", host, a.IP)
		}
	}
	return nil
}

func (g *Guard) checkIP(a netip.Addr, host string) error {

	if a.Zone() != "" {
		a = a.WithZone("")
	}

	a = a.Unmap()
	if v4, ok := unembedV4(a); ok {
		return g.checkIP(v4, host)
	}
	for _, p := range g.extraAllow {
		if p.Contains(a) {
			return nil
		}
	}
	for _, p := range blockedPrivate {
		if p.Contains(a) {

			return fmt.Errorf("egress: %q resolves to a private/reserved address %s — outbound to private, loopback, link-local and other reserved ranges is blocked by the SSRF guard", host, a)
		}
	}
	return nil
}

func unembedV4(a netip.Addr) (netip.Addr, bool) {
	if a.Is4() {
		return netip.Addr{}, false
	}
	b := a.As16()
	lo := [4]byte{b[12], b[13], b[14], b[15]}
	hi := b[:12]
	compatible := allZero(hi)
	translated := allZero(hi[:8]) && hi[8] == 0xff && hi[9] == 0xff && hi[10] == 0 && hi[11] == 0
	if compatible || translated || nat64WellKnown.Contains(a) {
		return netip.AddrFrom4(lo), true
	}
	return netip.Addr{}, false
}

func allZero(b []byte) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}
