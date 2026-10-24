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

func TestParseAmountForCurrency(t *testing.T) {
	tests := []struct {
		name     string
		display  string
		currency string
		want     int
	}{
		// Zero-decimal normalization: gateways may echo "4500.00" for JPY.
		{"jpy plain", "4500", "JPY", 4500},
		{"jpy zero-fraction echo normalized", "4500.00", "JPY", 4500},
		{"jpy single zero fraction", "4500.0", "JPY", 4500},
		{"jpy trailing dot", "4500.", "JPY", 4500},
		{"jpy nonzero fraction not convertible", "4500.5", "JPY", 0},
		{"jpy nonzero fraction two digits", "4500.50", "JPY", 0},
		{"jpy lowercase currency", "4500.00", "jpy", 4500},
		{"jpy negative", "-4500", "JPY", -4500},
		{"jpy negative echo", "-4500.00", "JPY", -4500},
		{"jpy garbage", "abc", "JPY", 0},
		{"jpy empty", "", "JPY", 0},
		{"jpy lone zero echo", "0.00", "JPY", 0},
		{"jpy whitespace trimmed", "  4500.00  ", "JPY", 4500},

		// Two-decimal currencies parse exactly like ParseAmount.
		{"usd unchanged", "19.00", "USD", 1900},
		{"usd one digit", "9.9", "USD", 990},
		{"usd garbage", "abc", "USD", 0},
		{"unknown currency falls back to two-decimal", "19.00", "XYZ", 1900},
		{"empty currency falls back to two-decimal", "19.00", "", 1900},
		{"three-decimal display still rejected for usd", "1.900", "USD", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ParseAmountForCurrency(tt.display, tt.currency); got != tt.want {
				t.Errorf("ParseAmountForCurrency(%q, %q) = %d, want %d", tt.display, tt.currency, got, tt.want)
			}
		})
	}
}

func TestFormatCentsChecked(t *testing.T) {
	// Supported currencies format exactly like FormatCents.
	if got, err := FormatCentsChecked(1900, "USD"); err != nil || got != "19.00" {
		t.Errorf("FormatCentsChecked(1900, USD) = %q, %v; want \"19.00\", nil", got, err)
	}
	if got, err := FormatCentsChecked(4500, "JPY"); err != nil || got != "4500" {
		t.Errorf("FormatCentsChecked(4500, JPY) = %q, %v; want \"4500\", nil", got, err)
	}
	// Three-decimal minor units are refused instead of priced 10x off.
	for _, currency := range []string{"KWD", "BHD", "OMR", "kwd"} {
		if got, err := FormatCentsChecked(1500, currency); err == nil {
			t.Errorf("FormatCentsChecked(1500, %s) = %q, nil; want error (3-decimal minor unit)", currency, got)
		}
	}
	// Unknown two-decimal-shaped currencies keep the lenient default.
	if got, err := FormatCentsChecked(990, "XYZ"); err != nil || got != "9.90" {
		t.Errorf("FormatCentsChecked(990, XYZ) = %q, %v; want \"9.90\", nil", got, err)
	}
}

func TestCheckMinorUnit(t *testing.T) {
	tests := []struct {
		name     string
		currency string
		wantErr  bool
	}{
		{"usd ok", "USD", false},
		{"jpy zero decimal ok", "JPY", false},
		{"lowercase ok", "usd", false},
		{"kwd rejected", "KWD", true},
		{"bhd rejected", "BHD", true},
		{"bad shape rejected", "US1", true},
		{"empty rejected", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := CheckMinorUnit(tt.currency); (err != nil) != tt.wantErr {
				t.Errorf("CheckMinorUnit(%q) error = %v, wantErr %v", tt.currency, err, tt.wantErr)
			}
		})
	}
}

// TestZeroDecimalEchoRoundTrip pins the JPY reconciliation invariant: an
// amount formatted by us must reconcile whether the gateway echoes it back
// verbatim or with a normalized ".00" suffix.
func TestZeroDecimalEchoRoundTrip(t *testing.T) {
	for _, cents := range []int{0, 1, 4500, 123456} {
		display := FormatCents(cents, "JPY")
		if got := ParseAmountForCurrency(display, "JPY"); got != cents {
			t.Errorf("ParseAmountForCurrency(FormatCents(%d, JPY)) = %d, want %d", cents, got, cents)
		}
		echo := display + ".00"
		if got := ParseAmountForCurrency(echo, "JPY"); got != cents {
			t.Errorf("ParseAmountForCurrency(%q, JPY) = %d, want %d", echo, got, cents)
		}
	}
}
