package app

import "testing"

func TestProcessorDisplayName(t *testing.T) {
	cases := []struct{ channel, want string }{
		{"waffo", "Waffo Pancake"},
		{"stripe", "Stripe"},
		{"paypal", "PayPal"},
		{"manual", ""},
		// Unknown future adapters fall back to the raw name — never a
		// silently blank disclosure placeholder.
		{"adyen", "adyen"},
	}
	for _, c := range cases {
		if got := ProcessorDisplayName(c.channel); got != c.want {
			t.Errorf("ProcessorDisplayName(%q) = %q, want %q", c.channel, got, c.want)
		}
	}
}
