package app

// ProcessorDisplayName maps a payment-channel name to the legal disclosure
// name for "payments are processed by …" copy (LC-1/LC-7): the merchant of
// record is disclosed under its legal brand, direct channels under their
// brand. The manual channel is deliberately "" — there is no external
// processor to disclose. Unknown future channels fall back to the raw name
// so a new adapter can never silently blank the placeholder.
func ProcessorDisplayName(channel string) string {
	switch channel {
	case "waffo":
		return "Waffo Pancake"
	case "stripe":
		return "Stripe"
	case "paypal":
		return "PayPal"
	case "manual":
		return ""
	default:
		return channel
	}
}
