// Package webhooks delivers workspace events to subscriber-controlled HTTP
// endpoints (the SaaS "outgoing webhook" surface).
//
// # Where it sits in the event pipeline
//
//	[product tx] --Emit--> platform/events (transactional bus, river-backed)
//	                     --handler--> webhooks Service Emit (this domain)
//	                     --fan-out--> one webhook_delivery row per matching subscription
//	                     --DeliveryWorker--> HTTP POST + signature + retry plan
//
// platform/events is the in-transaction spine (an emit rolls back with the
// business operation); this domain is the egress that turns bus events into
// signed HTTP deliveries. Products bridge the two with a per-kind handler
// (see example/cmd/app/main.go "billing webhook bridge" for the reference
// guard pattern: workspace + event-id checks, catalog check, then Emit).
//
// # Delivery contract for RECEIVERS
//
// Every delivery is a POST with a JSON body and these headers:
//
//	X-Signature      HMAC-SHA256 signature under the subscription secret (always)
//	X-Signature-Old  signature under the previous secret, only inside the 24h
//	                 rotation window after a secret rotate (whsign.OldSecretTTL)
//	X-Timestamp      signing time, RFC 3339 with nanoseconds
//	X-Event-Id       stable event id — receivers MUST dedupe on this header;
//	                 retries redeliver the same event id
//	X-Event-Type     event type from the catalog
//	X-Delivery-Id    per-attempt id — NOT a dedupe key (retries mint new ones)
//
// The signature algorithm, replay window, and a copy-paste verification recipe
// (including for non-Go receivers) live in platform/whsign — import that
// package, not this one, from receiver-side code.
//
// Retries: a non-2xx response (or transport error) schedules a retry with the
// backoff ladder RetryBackoff = 1m, 5m, 30m, 2h, 6h (±20% jitter). An attempt
// count exceeding len(RetryBackoff) marks the delivery dead; dead deliveries
// stay queryable (ListDeliveries) and can be resent via the redeliver API.
// These values are delivery-behavior defaults, not tunables; treat the ladder
// shape as contract and check this file's history when it changes.
//
// Receiver obligations: verify the signature over the RAW body before any
// parsing, reject timestamps outside your replay window (5 minutes
// recommended, whsign.RecommendedReplayWindow), and make handling idempotent
// on X-Event-Id — at-least-once delivery is the guarantee.
//
// Auto-disable: subscriptions whose deliveries fail continuously for
// AutoDisableWindow (5 days) are deactivated; a ping or manual reactivation
// revives them.
package webhooks
