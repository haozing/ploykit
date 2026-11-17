# Video Studio Documentation Map

Last updated: 2026-11-17. This file indexes every video-studio document in
`docs/`: authority ordering, status, and reading paths. It carries no
`plan-`/`delivery-audit-` prefix, so the docs language gate scans it; it is
English-only by design.

## Authority ordering

When documents disagree, higher on this list wins:

1. **IR v2 contract spec** (`plan-video-studio-ir-v2-spec-2026-11-17.md`,
   draft contract landed 2026-11-17; binding once v2 implementation starts).
   The single source of truth for IR v2 semantics and the one-shot migration
   table. It states v1 behaviors with file:line evidence and records open
   questions unresolved by design (15 at draft time).
2. **Architecture doc** (`plan-agent-video-studio-architecture-2026-11-14.md`,
   v1 current contract). The binding contract for the IR v1 era: invariants,
   error semantics, and the sole env var canon (Section 14). Section 0.5
   corrects its dated status claims as of 2026-11-17 and points at the v2
   direction.
3. **Compat doc** (`plan-agent-video-studio-compat-2026-11-14.md`). Env var
   compatibility and upgrade paths. Its env var names are superseded by
   architecture Section 14; the divergences are itemized in its status header.
4. **Agent tools plan** (`plan-video-studio-agent-tools-2026-11-16.md`). The
   agent tool surface walk-through (26 `video_*` MCP tools) and gap proposals,
   reconciled against the landed tools on 2026-11-17 (per-gap line evidence).
5. **Case library** (`plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md`).
   Test methodology: L0-L5 layering, golden discipline (Section 7.7 batch
   regeneration), and clock rulings with thresholds (Section 7.0). Valid
   across the v1-to-v2 transition.
6. **M3 image plan** (`plan-video-studio-m3-image-2026-11-16.md`). Render
   determinism: pinned render image, font subsetting, golden baseline
   migration.
7. **Delivery audits, round 0-9** (`delivery-audit-video-studio-*.md`).
   Historical implementation records, read-only. Each round is a snapshot of
   a past work-tree state; never treat them as current contract.

## Document inventory

| File | Date | Language | Status | Role |
|---|---|---|---|---|
| plan-video-studio-ir-v2-spec-2026-11-17.md | 2026-11-17 | zh | draft contract (landed; 15 open questions) | IR v2 contract spec: per-field v1-to-v2 table, builder simplification list, one-shot migration table, code-evidenced v1 behavior |
| plan-video-studio-ir-v2-2026-11-17.md | 2026-11-17 | zh | approved proposal (drives the docs refactor) | IR v2 and bake-layer refactor plan: contract, bake, audio, feedback layers; explicitly no v1 compat layer |
| plan-agent-video-studio-architecture-2026-11-14.md | 2026-11-14 | zh | v1 current contract; Section 0.5 status correction landed 2026-11-17 | target architecture, invariants, error semantics, env var canon (Section 14) |
| plan-agent-video-studio-compat-2026-11-14.md | 2026-11-14 | zh | written pre-implementation; env var names superseded by architecture Section 14 (see its status header) | compatibility impact assessment; upgrade paths for framework consumers and example deployments |
| plan-video-studio-agent-tools-2026-11-16.md | 2026-11-16 | zh | reconciled against landed tools 2026-11-17 (G-01..G-11 landed, per-gap line evidence) | agent tool surface walk-through (26 video_* MCP tools) and gap proposals |
| plan-agent-video-studio-case-library-and-test-plan-2026-11-15.md | 2026-11-15 | zh | v1.0; IR v1 based; one-shot v2 migration pending (see its status header) | 9 real cases, fixture suite, L0-L5 test methodology, golden discipline, clock rulings |
| plan-video-studio-m3-image-2026-11-16.md | 2026-11-16 | zh | P0 font subset landed (round 8); P1 image plan finalized but not implemented; P2+ gated on the image (see its status header) | render determinism: pinned render image, font subsetting, golden baseline migration |
| delivery-audit-video-studio-2026-11-15.md | 2026-11-15 | zh | historical, read-only (round 0) | first full audit of the architecture doc against master 303c010 |
| delivery-audit-video-studio-round1-2026-11-15.md | 2026-11-15 | zh | historical, read-only | L1 golden bootstrap; birth browser Edge 157.0.8103.51 recorded |
| delivery-audit-video-studio-round2-2026-11-15.md | 2026-11-15 | zh | historical, read-only | A/B baseline semantics; C02 assertion calibration |
| delivery-audit-video-studio-round3-2026-11-15.md | 2026-11-15 | zh | historical, read-only | L5 100x identical on Windows; 103ms/frame steady state |
| delivery-audit-video-studio-round4-2026-11-15.md | 2026-11-15 | zh | historical, read-only | case library test batch 4 |
| delivery-audit-video-studio-round5-2026-11-15.md | 2026-11-15 | zh | historical, read-only | tripwire signature refresh (X-4 fix) |
| delivery-audit-video-studio-round6-2026-11-16.md | 2026-11-16 | zh | historical, read-only | M2 close-out; nine-case goldens landed; M3 kickoff item |
| delivery-audit-video-studio-round7-2026-11-16.md | 2026-11-16 | zh | historical, read-only | case library test batch 7 (consolidation) |
| delivery-audit-video-studio-round8-2026-11-16.md | 2026-11-16 | zh | historical, read-only | M3 P0 font subset landed (Noto Sans SC VF, 217KB, 948 codepoints); migration 1011; reconciler |
| delivery-audit-video-studio-round9-2026-11-16.md | 2026-11-16 | zh | historical, read-only | latest verified state: L0-L3 fully green, check_api 175:175, 26 video_* tools; M3 P1-P3 listed as next |

Current implementation state (2026-11-17): round 9 reached L0-L3 fully green
with check_api 175:175 and a 26-tool `video_*` MCP surface; MaxElements was
raised from 64 to 128 in `ir.go` (2026-11-17).

## Reading paths

- **Newcomer who wants the current state**: read the architecture doc (start
  with its Section 0.5 status correction), then delivery audit round 9 for
  the latest verified implementation state, then case library Section 0 to
  learn how evidence claims are graded. Skip rounds 0-8 unless tracing a
  specific decision; this map plus round 9 is enough.
- **Engineer doing the v2 migration**: read the IR v2 plan (root causes R0-R5
  and the four-layer clean design), then the v2 contract spec - its migration
  table drives the one-shot migration of the 9 case fixtures, shuijing promo,
  and the toolsite pilot ir.json, and its Section 5 lists the 15 open
  questions that must be decided before implementation. The case library
  status header states what the migration must preserve (L0-L5 methodology,
  golden discipline, and clock rulings carry over unchanged). The compat
  status header lists every env var that v2 adds or changes.
- **Looking up an environment variable**: architecture doc Section 14 is the
  sole canon. The compat doc's names (`FFMPEG_PATH`, `TTS_URL`,
  `ALIGNER_URL`) are superseded; the divergences are itemized in the compat
  status header. v2 will add asset-budget and font-asset variables (per IR v2
  plan Sections 3.1 and 3.3); the compat header will be updated when v2 lands.
