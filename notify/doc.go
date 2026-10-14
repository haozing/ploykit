// Package notify is the notification domain: the in-app bell (notification
// table + preferences) plus the email adapter surface.
//
// # Transactional vs notification email — which entry to call
//
// The two product-facing send paths serve different legal and preference
// regimes; picking the wrong one is a compliance bug, not a style choice:
//
//   - NotifyService.SendEmail(ctx, to, subject, body) — TRANSACTIONAL email
//     (order receipts, password events, "your work received a comment").
//     Bypasses notification preferences and unsubscribe semantics on purpose:
//     transactional messages are exempt from CAN-SPAM bulk rules (they
//     complete a transaction the recipient initiated). Use when the message
//     belongs to an interaction the user already took part in.
//   - NotifyService.SendTypeEmail(ctx, userID, typ, to, subject, body) —
//     NOTIFICATION email (product news, digests, optional alerts). Honors
//     the user's per-type preference gate (email_enabled; users can silence
//     these). Everything promotional or optional goes through here.
//   - NotifyService.Notify / NotifyOncePerMonth — the in-app bell with
//     dedup semantics (dedup_key once-ever, once-per-month for recurring
//     nudges); pair with SendTypeEmail when a notification should also email.
//
// The recipe for "event X happened, email user Y" (a comment lands on a
// work item):
//
//	func onComment(ctx context.Context, authorEmail, workTitle string) error {
//	    // transactional: the author initiated the thread — no preference gate
//	    return notifySvc.SendEmail(ctx, authorEmail,
//	        "New comment on "+workTitle, commentBody)
//	}
//
// Wiring lives in the product's event handlers (see example/cmd/app/main.go
// for NotifyService assembly); the email adapter (SMTP or dev-log) is
// injected at the composition root.
package notify
