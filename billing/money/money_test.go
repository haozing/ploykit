package money

import "testing"

func TestFormatCents(t *testing.T) {
	tests := []struct {
		name     string
		cents    int
		currency string
		want     string
	}{
		{"usd two decimals", 1900, "USD", "19.00"},
		{"usd trailing zero", 990, "USD", "9.90"},
		{"jpy zero decimal", 4500, "JPY", "4500"},
		{"jpy lowercase currency", 990, "jpy", "990"},
		{"usd lowercase currency", 990, "usd", "9.90"},
		{"zero usd", 0, "USD", "0.00"},
		{"zero jpy", 0, "JPY", "0"},
		{"sub-dollar usd", 5, "USD", "0.05"},
		{"sub-dollar with tens", 19, "USD", "0.19"},
		{"negative usd", -1900, "USD", "-19.00"},
		{"negative jpy", -4500, "JPY", "-4500"},
		{"negative with fraction", -1905, "USD", "-19.05"},
		{"empty currency defaults to two decimals", 990, "", "9.90"},
		{"unknown currency defaults to two decimals", 990, "XYZ", "9.90"},
		{"large amount", 123456789, "USD", "1234567.89"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatCents(tt.cents, tt.currency); got != tt.want {
				t.Errorf("FormatCents(%d, %q) = %q, want %q", tt.cents, tt.currency, got, tt.want)
			}
		})
	}
}

func TestParseAmount(t *testing.T) {
	tests := []struct {
		name    string
		display string
		want    int
	}{
		// Documented behavior from the plan (§BC-3).
		{"two decimals", "9.90", 990},
		{"no decimals", "4500", 4500},
		{"one decimal digit accepted", "9.9", 990},
		{"negative", "-19.00", -1900},
		{"negative no decimals", "-4500", -4500},

		// Boundary shapes.
		{"zero", "0.00", 0},
		{"bare zero", "0", 0},
		{"leading fraction only", ".50", 50},
		{"trailing dot", "19.", 1900},
		{"three fraction digits rejected", "19.005", 0},
		{"multiple dots rejected", "1.2.3", 0},
		{"empty rejected", "", 0},
		{"surrounding whitespace trimmed", "  9.90  ", 990},
		{"plus sign accepted", "+9.90", 990},
		{"lone sign rejected", "-", 0},
		{"lone plus rejected", "+", 0},
		{"lone dot rejected", ".", 0},
		{"letters rejected", "abc", 0},
		{"digits and letters rejected", "12a.00", 0},
		{"comma separator rejected", "9,90", 0},
		{"hex rejected", "0x10", 0},
		{"float syntax rejected", "1e3", 0},
		{"thousands separator rejected", "1,900", 0},
		{"whitespace inside rejected", "9 900", 0},
		{"integer overflow rejected", "9999999999999999999999", 0},
		{"jpy style large", "450000", 450000},
		{"leading zeros", "09.90", 990},
		{"negative fraction-only", "-.50", -50},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ParseAmount(tt.display); got != tt.want {
				t.Errorf("ParseAmount(%q) = %d, want %d", tt.display, got, tt.want)
			}
		})
	}
}

func TestValidateCurrency(t *testing.T) {
	tests := []struct {
		name     string
		currency string
		wantErr  bool
	}{
		{"uppercase", "USD", false},
		{"lowercase", "usd", false},
		{"mixed case", "UsD", false},
		{"too short", "US", true},
		{"too long", "USDD", true},
		{"empty", "", true},
		{"digit inside", "US1", true},
		{"symbol inside", "U-D", true},
		{"space inside", "U D", true},
		{"non-ascii letters", "欧元", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateCurrency(tt.currency)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateCurrency(%q) error = %v, wantErr %v", tt.currency, err, tt.wantErr)
			}
		})
	}
}

// TestRoundTrip pins the invariant the adapters rely on: formatting then
// parsing (and vice versa) must not drift for two-decimal currencies.
func TestRoundTrip(t *testing.T) {
	for _, cents := range []int{0, 1, 5, 99, 100, 990, 1900, 6900, 123456789} {
		if got := ParseAmount(FormatCents(cents, "USD")); got != cents {
			t.Errorf("ParseAmount(FormatCents(%d, \"USD\")) = %d, want %d", cents, got, cents)
		}
	}
	for _, display := range []string{"0.00", "9.90", "19.00", "4500", "1234567.89"} {
		cents := ParseAmount(display)
		if got := FormatCents(cents, "USD"); ParseAmount(got) != cents {
			t.Errorf("round trip of %q drifted: %q -> %d -> %q", display, display, cents, got)
		}
	}
	// Zero-decimal currencies round trip without a decimal point.
	for _, cents := range []int{0, 4500, 123456} {
		if got := ParseAmount(FormatCents(cents, "JPY")); got != cents {
			t.Errorf("ParseAmount(FormatCents(%d, \"JPY\")) = %d, want %d", cents, got, cents)
		}
	}
}
