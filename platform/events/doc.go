// Package events is the transactional event substrate: Emit writes the event
// inside the caller's database transaction (outbox), a river worker picks it
// up and the dispatcher invokes the kind's handler.
//
// Handler contract: exactly ONE handler per event kind — a second Subscribe
// for the same kind panics at wiring time. The substrate gives NO ordering
// across kinds: kinds execute asynchronously through river workers, so any
// sequencing a business flow needs (step A before step B) belongs inside the
// handler (or as explicit follow-up events), never in registration order.
// Multi-listener same-phase cascades with ordering guarantees are a
// consumer-side bus pattern, not provided here.
package events
