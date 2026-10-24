// Package money provides the shared cents <-> display-string conversions used
// by every payment-channel adapter (waffo, stripe, paypal). Channels carry
// amounts as display strings ("9.90"; zero-decimal currencies such as JPY
// carry "4500"), and every adapter needs the same two conversions — this
// package replaces the per-adapter private formatAmount/parseAmount copies
// (plan docs/plan-billing-channel-framework-2026-10-23.md §BC-3).
//
// ParseAmount returns the zero value instead of an error for untrusted input.
// Amount fields inside webhook payloads cannot be trusted to be well-formed;
// the existing amountMismatch semantics in billing/app treat
// event.AmountCents <= 0 as "no amount to reconcile" and route the event down
// the ignore path rather than failing it. Mapping malformed amounts to 0
// keeps that contract: garbage amounts degrade to "not reconcilable" instead
// of breaking event processing.
package money

import (
	"fmt"
	"math"
	"strings"
)

// zeroDecimal lists ISO 4217 currencies whose minor unit has exponent 0 and
// that the framework's channels actually need today. Extend on demand; do not
// speculatively add codes — three-decimal currencies (KWD, BHD, …) need a
// different code path and must not be silently listed here.
var zeroDecimal = map[string]bool{
	"JPY": true,
}

// threeDecimal lists ISO 4217 currencies whose minor unit has exponent 3.
// The framework converts between minor units and display strings only for
// exponents 0 and 2; a three-decimal currency flowing through FormatCents
// would be silently priced 10x off (1500 fils → "15.00" instead of 1.500),
// so these are rejected rather than approximated.
var threeDecimal = map[string]bool{
	"BHD": true, "IQD": true, "JOD": true, "KWD": true, "LYD": true, "OMR": true, "TND": true,
}

// CheckMinorUnit reports whether the framework can correctly convert between
// minor units and display strings for this currency: ISO 4217 shape, minor
// unit exponent 0 (JPY) or 2. Three-decimal currencies (KWD, BHD, …) return
// an error instead of being approximated — wire this into plan/price
// validation so they are rejected at the edge, never at the cashier.
func CheckMinorUnit(currency string) error {
	if err := ValidateCurrency(currency); err != nil {
		return err
	}
	if threeDecimal[strings.ToUpper(currency)] {
		return fmt.Errorf("currency %q has a 3-decimal minor unit, which the framework does not support (pricing would be 10x off)", strings.ToUpper(currency))
	}
	return nil
}

// FormatCentsChecked is FormatCents for untrusted currency input: it refuses
// three-decimal minor units instead of formatting them wrong. Callers that
// build channel-side prices from a plan currency must use this and surface
// the error; FormatCents stays for already-validated currencies.
func FormatCentsChecked(cents int, currency string) (string, error) {
	if threeDecimal[strings.ToUpper(currency)] {
		return "", fmt.Errorf("money: currency %q has a 3-decimal minor unit, refusing to format %d minor units as a 2-decimal amount", strings.ToUpper(currency), cents)
	}
	return FormatCents(cents, currency), nil
}

// ParseAmountForCurrency parses a display string according to the currency's
// minor-unit exponent. For zero-decimal currencies (JPY) it additionally
// normalizes the "4500.00" echo form some gateways send back: an all-zero
// fraction is stripped ("4500.00" → 4500, "4500." → 4500), while any nonzero
// fraction is not convertible to a whole minor unit and yields 0 (the
// established "not reconcilable" convention). Every other currency parses
// exactly like ParseAmount.
func ParseAmountForCurrency(display, currency string) int {
	if !zeroDecimal[strings.ToUpper(currency)] {
		return ParseAmount(display)
	}
	s := strings.TrimSpace(display)
	if i := strings.IndexByte(s, '.'); i >= 0 {
		if frac := s[i+1:]; frac != "" && strings.Trim(frac, "0") != "" {
			return 0
		}
		s = s[:i]
	}
	return ParseAmount(s)
}

// FormatCents converts a minor-unit integer to the channel display string.
// Zero-decimal currencies (JPY) carry no decimal point; all others use two
// decimal places: 1900/"USD" -> "19.00", 4500/"JPY" -> "4500",
// 990/"USD" -> "9.90". Currency matching is case-insensitive; an empty or
// unknown currency formats as two-decimal.
func FormatCents(cents int, currency string) string {
	if zeroDecimal[strings.ToUpper(currency)] {
		return fmt.Sprintf("%d", cents)
	}
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}

// ParseAmount converts a display string to a minor-unit integer: "9.90" -> 990,
// "4500" -> 4500, "9.9" -> 990 (1 or 2 fraction digits are both accepted),
// "-19.00" -> -1900. Surrounding whitespace is trimmed; a lone dot with digits
// on one side is accepted (".50" -> 50, "19." -> 1900).
//
// Anything that is not a plain (optionally signed) decimal with at most two
// fraction digits — empty string, non-digits, more than one dot, three or
// more fraction digits, integer overflow — yields 0, not an error: amount
// fields in event payloads are untrusted, and the amountMismatch semantics
// treat an amount of 0 as "not reconcilable" and ignore it.
func ParseAmount(display string) int {
	s := strings.TrimSpace(display)
	if s == "" {
		return 0
	}
	neg := false
	switch s[0] {
	case '-':
		neg = true
		s = s[1:]
	case '+':
		s = s[1:]
	}
	if s == "" {
		return 0
	}

	// A missing dot (zero-decimal display, e.g. "4500") already carries the
	// minor-unit integer; a dot present means major units and 1-2 fraction
	// digits that scale by 100.
	intPart, fracPart, hasDot := s, "", false
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, fracPart, hasDot = s[:i], s[i+1:], true
	}
	if len(fracPart) > 2 || !digitsOnly(intPart) || !digitsOnly(fracPart) {
		return 0
	}

	var units int
	if hasDot {
		u, err := parseUnits(intPart, fracPart)
		if err != nil {
			return 0
		}
		units = u
	} else {
		u, err := atoiClamped(intPart)
		if err != nil {
			return 0
		}
		units = u
	}
	if neg {
		units = -units
	}
	return units
}

// digitsOnly reports whether s consists solely of ASCII digits (the empty
// string qualifies: the missing side of ".50" / "19." carries no garbage).
func digitsOnly(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// parseUnits combines the digit-only integer part with the fraction part
// (0-2 digits) into minor units, guarding against int overflow.
func parseUnits(intPart, fracPart string) (int, error) {
	whole, err := atoiClamped(intPart)
	if err != nil {
		return 0, err
	}
	frac := 0
	for i := 0; i < len(fracPart); i++ {
		frac = frac*10 + int(fracPart[i]-'0')
	}
	if len(fracPart) == 1 { // "9.9" -> 90, not 9: pad to two minor digits
		frac *= 10
	}
	// frac <= 99, so whole*100 overflows only when whole exceeds this bound.
	if whole > (math.MaxInt-99)/100 {
		return 0, fmt.Errorf("money: amount overflow")
	}
	return whole*100 + frac, nil
}

// atoiClamped parses an ASCII-digit string into an int, returning an error
// instead of wrapping around on overflow.
func atoiClamped(digits string) (int, error) {
	v := 0
	for i := 0; i < len(digits); i++ {
		d := int(digits[i] - '0')
		if v > (math.MaxInt-d)/10 {
			return 0, fmt.Errorf("money: amount overflow")
		}
		v = v*10 + d
	}
	return v, nil
}

// ValidateCurrency reports whether currency has the ISO 4217 shape: exactly
// three ASCII letters, judged after case normalization ("USD", "usd" and
// "UsD" are all valid; "US", "USDD", "US1" and "" are not).
func ValidateCurrency(currency string) error {
	if len(currency) != 3 {
		return fmt.Errorf("invalid currency %q: want exactly 3 ASCII letters", currency)
	}
	for i := 0; i < len(currency); i++ {
		c := currency[i]
		if !('a' <= c && c <= 'z' || 'A' <= c && c <= 'Z') {
			return fmt.Errorf("invalid currency %q: want exactly 3 ASCII letters", currency)
		}
	}
	return nil
}
