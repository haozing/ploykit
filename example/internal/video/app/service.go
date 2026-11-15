package videoapp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/pg"
	"github.com/haozing/ploykit/platform/webx"
	"github.com/haozing/ploykit/quota"
)

// Domain error codes (§4.6): HTTP maps them via *webx.Error; MCP tools pass
// the code through as error text.
var (
	ErrProjectNotFound  = webx.NewError(404, "E_VIDEO_PROJECT_NOT_FOUND", "video project not found")
	ErrRenderNotFound   = webx.NewError(404, "E_VIDEO_RENDER_NOT_FOUND", "video render not found")
	ErrVersionConflict  = webx.NewError(409, "E_VIDEO_VERSION_CONFLICT", "ir version conflict")
	ErrAnchorNotFound   = webx.NewError(400, "E_VIDEO_ANCHOR_NOT_FOUND", "anchor text not found in words")
	ErrNotConfigured    = webx.NewError(503, "E_NOT_CONFIGURED", "render capability not configured")
	ErrForbidden        = webx.NewError(403, "E_FORBIDDEN", "not a member of this workspace")
	ErrInternalPreview  = webx.NewError(500, "E_VIDEO_PREVIEW_INTERNAL", "preview CSP hash unavailable")
	ErrAssetTooLarge    = webx.NewError(400, "E_VIDEO_ASSET_TOO_LARGE", "asset exceeds the size limit")
	ErrAssetUnsupported = webx.NewError(400, "E_VIDEO_ASSET_UNSUPPORTED", "asset content type not allowed")
)

// QuotaKey is the monthly render quota key (declared in migration 1008).
const QuotaKey = "video_renders_monthly"

// WS event names (§4.8).
const (
	EventIRUpdated     = "video.ir.updated"
	EventRenderUpdated = "video.render.updated"
)

// Audit actions (§4.9.3).
const (
	AuditProjectCreated  = "video.project.created"
	AuditIRUpdated       = "video.ir.updated"
	AuditRenderCreated   = "video.render.created"
	AuditRenderCompleted = "video.render.completed"
	AuditRenderFailed    = "video.render.failed"
	AuditAssetUploaded   = "video.asset.uploaded"
	AuditProjectDeleted  = "video.project.deleted"
	AuditRenderInterrupt = "video.render.interrupted"
	AuditMutationFailed  = "video.project.mutation_failed"
)

// UploadLimit is the asset size cap for the MCP upload path (~700KB inside
// the /mcp 1MiB body limit). Large assets go through the REST multipart
// endpoint which inherits the same /api 1MiB gate by default.
const UploadLimit = 700 << 10

// RenderParams are the render-time overrides persisted with ir_snapshot
// (§4.9.5): params + snapshot jointly reproduce output_key.
type RenderParams struct {
	FPS           int     `json:"fps,omitempty"`
	Width         int     `json:"width,omitempty"`
	Height        int     `json:"height,omitempty"`
	BurnSubtitles bool    `json:"burn_subtitles"`
	SubtitleMode  string  `json:"subtitle_mode,omitempty"` // burn|soft|none
	BGMVolume     float64 `json:"bgm_volume,omitempty"`
}

// normalize fills defaults per §4.9.5 (fps/size default to IR meta).
func (p *RenderParams) normalize(ir *IR) {
	if p.FPS == 0 {
		p.FPS = ir.Meta.FPS
	}
	if p.Width == 0 {
		p.Width = ir.Meta.Width
	}
	if p.Height == 0 {
		p.Height = ir.Meta.Height
	}
	if p.SubtitleMode == "" {
		if p.BurnSubtitles {
			p.SubtitleMode = "burn"
		} else {
			p.SubtitleMode = "none"
		}
	}
	switch p.SubtitleMode {
	case "burn", "soft", "none":
	default:
		p.SubtitleMode = "none"
	}
}

// Project is the REST-facing projection of one video_project row.
type Project struct {
	ID        string    `json:"id"`
	Workspace string    `json:"workspace_id"`
	Title     string    `json:"title"`
	Script    string    `json:"script"`
	IR        *IR       `json:"ir"`
	Version   int       `json:"version"`
	CreatedBy string    `json:"created_by"`
	UpdatedBy string    `json:"updated_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Render is the REST-facing projection of one video_render row.
type Render struct {
	ID          string       `json:"id"`
	ProjectID   string       `json:"project_id"`
	Workspace   string       `json:"workspace_id"`
	Status      string       `json:"status"`
	Params      RenderParams `json:"params"`
	FramesDone  int          `json:"frames_done"`
	FramesTotal int          `json:"frames_total"`
	OutputKey   string       `json:"output_key"`
	Error       string       `json:"error"`
	CreatedBy   string       `json:"created_by"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	FinishedAt  *time.Time   `json:"finished_at,omitempty"`

	// submissionKey/quotaPeriod serve idempotency and period-fixed release
	// (migration 1009); not part of the API payload.
	submissionKey string
	quotaPeriod   string
	releasedAt    *time.Time
}

// Render statuses (§4.9.1).
const (
	RenderQueued      = "queued"
	RenderRunning     = "running"
	RenderSucceeded   = "succeeded"
	RenderFailed      = "failed"
	RenderInterrupted = "interrupted"
)

// ProjectService is the single mutation entry for the video domain (§4.3).
// HTTP handlers and MCP tools call the same methods; all tenancy checks,
// optimistic locking, anchor re-resolution, audit and WS push live here.
type ProjectService struct {
	pool  *pgxpool.Pool
	ports Ports
	log   *slog.Logger
	now   func() time.Time
}

func NewProjectService(pool *pgxpool.Pool, ports Ports, log *slog.Logger) *ProjectService {
	if log == nil {
		log = slog.Default()
	}
	return &ProjectService{pool: pool, ports: ports, log: log, now: time.Now}
}

// SetClock overrides the time source (tests).
func (s *ProjectService) SetClock(now func() time.Time) { s.now = now }

// canAccess implements the membership check with the platform-admin
// exemption: admins bypass Membership; everyone else must pass the port.
func (s *ProjectService) canAccess(ctx context.Context, wsID, userID string, isPlatformAdmin bool) (bool, error) {
	if isPlatformAdmin {
		return true, nil
	}
	if s.ports.Membership == nil {
		return false, fmt.Errorf("video: membership port not wired")
	}
	return s.ports.Membership.IsMember(ctx, wsID, userID)
}

// Mutate is the transactional change entry (§4.3): row lock (FOR UPDATE),
// ownership + optimistic version check, mutation fn, full Validate, anchor
// re-resolution, version bump, in-tx audit; WS publish deferred to the
// committed hook so a push never precedes its commit.
func (s *ProjectService) Mutate(ctx context.Context, p *webx.Principal, projectID string, expectedVersion *int,
	fn func(ir *IR) error) (newVersion int, resolutions []AnchorResolution, err error) {

	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return 0, nil, aerr
	}
	if !ok {
		return 0, nil, ErrForbidden
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(ctx)

	var irJSON []byte
	var version int
	err = tx.QueryRow(ctx,
		`SELECT ir, version FROM video_project WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
		projectID, p.WorkspaceID).Scan(&irJSON, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, ErrProjectNotFound
	}
	if err != nil {
		return 0, nil, err
	}
	if expectedVersion != nil && *expectedVersion != version {
		// Optimistic-lock conflict is an auditable mutation failure
		// (v2.0 Â§13): the row survives, so Record (no tx) is correct.
		if s.ports.Audit != nil {
			s.ports.Audit.Record(ctx, &p.WorkspaceID, p.UserID,
				AuditMutationFailed, "video_project", projectID,
				map[string]any{"reason": "version_conflict",
					"expected": *expectedVersion, "current": version})
		}
		return 0, nil, conflict(version)
	}

	ir := &IR{}
	if len(irJSON) > 0 {
		if uerr := json.Unmarshal(irJSON, ir); uerr != nil {
			return 0, nil, fmt.Errorf("stored ir unreadable: %w", uerr)
		}
	}

	if ferr := fn(ir); ferr != nil {
		return 0, nil, ferr
	}
	if verr := Validate(ir); verr != nil {
		return 0, nil, irInvalid(verr)
	}

	// Full anchor re-resolution after every change (§4.3): prev resolved
	// indexes feed drift measurement, results write back resolvedFrom.
	resolutions = ResolveAll(ir, PrevWordIndexes(ir))

	updated := irBytes(ir)
	err = tx.QueryRow(ctx,
		`UPDATE video_project SET ir=$3, version=version+1, updated_by=$4, updated_at=$5
		 WHERE id=$1 AND workspace_id=$2 RETURNING version`,
		projectID, p.WorkspaceID, updated, p.UserID, s.now()).Scan(&newVersion)
	if err != nil {
		return 0, nil, err
	}

	if s.ports.Audit != nil {
		meta := map[string]any{"version": newVersion, "origin": originOf(ctx)}
		if aerr := s.ports.Audit.RecordTx(ctx, tx, &p.WorkspaceID, p.UserID,
			AuditIRUpdated, "video_project", projectID, meta); aerr != nil {
			return 0, nil, aerr
		}
	}

	// Committed hook: publish only after the tx survives (§4.3 note).
	payload, _ := json.Marshal(map[string]any{
		"project_id": projectID, "version": newVersion,
		"updated_by": p.UserID, "origin": originOf(ctx),
	})
	commitPublish := func(ctx context.Context) {
		if s.ports.Publish == nil {
			return
		}
		if perr := s.ports.Publish.BroadcastEvent(ctx, EventIRUpdated, payload, ids.NewV7().String()); perr != nil {
			s.log.Warn("video ir push failed", "project_id", projectID, "err", perr)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, nil, err
	}
	commitPublish(context.WithoutCancel(ctx))
	return newVersion, resolutions, nil
}

func conflict(current int) error {
	return webx.NewError(409, "E_VIDEO_VERSION_CONFLICT",
		fmt.Sprintf("expected version mismatch (current %d)", current))
}

func irInvalid(verr error) error {
	msg := verr.Error()
	field := ""
	var fv *ValidationError
	if errors.As(verr, &fv) {
		field, msg = fv.Field, fv.Msg
	}
	return webx.NewError(400, "E_VIDEO_IR_INVALID", fieldMsg(field, msg))
}

// fieldMsg embeds the offending field path in the message (the Error body's
// single message string is the surface both HTTP clients and MCP agents see).
func fieldMsg(field, msg string) string {
	if field == "" {
		return msg
	}
	return field + ": " + msg
}

type originKey struct{}

// WithOrigin tags the mutation source for audit + WS frames ("mcp"|"ui").
func WithOrigin(ctx context.Context, origin string) context.Context {
	return context.WithValue(ctx, originKey{}, origin)
}

func originOf(ctx context.Context) string {
	v, _ := ctx.Value(originKey{}).(string)
	if v == "" {
		return "ui"
	}
	return v
}

// irBytes marshals with sorted deterministic output (encoding/json map order
// is already deterministic for structs).
func irBytes(ir *IR) []byte {
	ir.normalizeSchema()
	b, _ := json.Marshal(ir)
	return b
}

// Create inserts a fresh project with an empty IR.
func (s *ProjectService) Create(ctx context.Context, p *webx.Principal, title string) (*Project, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	id := ids.NewV7().String()
	ir := &IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 10}}
	if verr := Validate(ir); verr != nil {
		return nil, irInvalid(verr)
	}
	now := s.now()
	var pr Project
	err := s.pool.QueryRow(ctx, `
		INSERT INTO video_project (id, workspace_id, title, ir, created_by, updated_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$5,$6,$6)
		RETURNING id, workspace_id, title, ir, version, created_by, updated_by, created_at, updated_at`,
		id, p.WorkspaceID, title, irBytes(ir), p.UserID, now).
		Scan(&pr.ID, &pr.Workspace, &pr.Title, &irDest{&pr.IR}, &pr.Version,
			&pr.CreatedBy, &pr.UpdatedBy, &pr.CreatedAt, &pr.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if s.ports.Audit != nil {
		s.ports.Audit.Record(ctx, &p.WorkspaceID, p.UserID, AuditProjectCreated, "video_project", id,
			map[string]any{"origin": originOf(ctx)})
	}
	return &pr, nil
}

// irDest adapts *IR into a sql-scannable destination.
type irDest struct{ dst **IR }

func (d irDest) Scan(src any) error {
	b, ok := src.([]byte)
	if !ok {
		return fmt.Errorf("ir column not []byte")
	}
	ir := &IR{}
	if len(b) > 0 {
		if err := json.Unmarshal(b, ir); err != nil {
			return err
		}
	}
	ir.normalizeSchema()
	*d.dst = ir
	return nil
}

// List returns the workspace's projects, newest first.
func (s *ProjectService) List(ctx context.Context, p *webx.Principal) ([]Project, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, workspace_id, title, version, updated_at FROM video_project
		WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 200`, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var pr Project
		if err := rows.Scan(&pr.ID, &pr.Workspace, &pr.Title, &pr.Version, &pr.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

// Get loads one project (ownership enforced).
func (s *ProjectService) Get(ctx context.Context, p *webx.Principal, projectID string) (*Project, error) {
	pr := Project{IR: &IR{}}
	// Workspace predicate FIRST: a cross-workspace id yields the same 404 as
	// a missing id — no existence leak, and the membership check ordering
	// cannot turn it into a distinguishable 403.
	err := s.pool.QueryRow(ctx, `
		SELECT id, workspace_id, title, ir, version, created_by, updated_by, created_at, updated_at
		FROM video_project WHERE id=$1 AND workspace_id=$2`, projectID, p.WorkspaceID).
		Scan(&pr.ID, &pr.Workspace, &pr.Title, &irDest{&pr.IR}, &pr.Version,
			&pr.CreatedBy, &pr.UpdatedBy, &pr.CreatedAt, &pr.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrProjectNotFound
	}
	if err != nil {
		return nil, err
	}
	// Known project in this workspace: membership decides (platform admins
	// pass; non-members get 403).
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	return &pr, nil
}

// Delete removes a project (renders cascade via FK).
func (s *ProjectService) Delete(ctx context.Context, p *webx.Principal, projectID string) error {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return aerr
	}
	if !ok {
		return ErrForbidden
	}
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM video_project WHERE id=$1 AND workspace_id=$2`, projectID, p.WorkspaceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrProjectNotFound
	}
	// Delete IS an audited lifecycle event (v2.0 Â§13): renders cascade via
	// FK, so this record is the only trace the project ever existed.
	if s.ports.Audit != nil {
		s.ports.Audit.Record(ctx, &p.WorkspaceID, p.UserID,
			AuditProjectDeleted, "video_project", projectID, nil)
	}
	return nil
}

// --- mutation methods (one per MCP tool / REST route pair, §4.3) ---

// SetScript updates the script and re-derives words: TTS direct when wired,
// Aligner for an existing voice track, otherwise the char-proportional
// estimate (§4.3 SetScript internal). Never blocks the caller on a missing
// capability.
//
// Two-phase (v2.0 §6.3; delivery audit P6): the external TTS/Aligner/storage
// calls run OUTSIDE the row lock — holding SELECT FOR UPDATE across a 60s
// vendor call pinned the row, queued every concurrent Mutate, and held a
// pool connection. Phase 1 reads the IR WITHOUT the lock to gather the
// derivation inputs; phase 2 takes the short lock, re-validates the
// optimistic version, and applies. If the voice track changed between the
// phases (concurrent edit), aligner words would be pinned to stale audio —
// the closure detects the drift and falls back to estimate, which is always
// safe.
func (s *ProjectService) SetScript(ctx context.Context, p *webx.Principal, projectID, script string, expectedVersion *int) (int, []AnchorResolution, string, error) {
	// Phase 0: cheap gate + unlocked read for the derivation inputs
	// (best-effort snapshot; the locked phase re-validates the version).
	pr, err := s.Get(ctx, p, projectID)
	if err != nil {
		return 0, nil, "", err
	}
	if expectedVersion != nil && *expectedVersion != pr.Version {
		return 0, nil, "", conflict(pr.Version)
	}

	// Phase 1: external calls with NO row lock held.
	pre, src, derr := s.deriveWordsUnlocked(ctx, pr.IR, script)
	if derr != nil {
		return 0, nil, "", derr
	}

	// Phase 2: short transaction; apply the pre-derived words.
	source := src
	var resolutions []AnchorResolution
	newVersion, resolutions, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		ir.Script = script
		if pre.staleAgainst(ir) {
			// Voice track changed between the phases: aligner words are
			// pinned to the old audio — drop to estimate (always safe).
			s.log.Info("setscript: voice changed during derivation; falling back to estimate", "project_id", projectID)
			ir.Words = EstimateWords(script, ir.Meta.DurationSec)
			source = WordSourceEstimated
			return nil
		}
		ir.Words = pre.words
		ir.Audio = pre.audio
		return nil
	})
	if err != nil {
		return 0, nil, "", err
	}
	return newVersion, resolutions, source, nil
}

// derivedWords is the phase-1 payload: the words/audio computed outside the
// lock, plus the observation they were based on (staleAgainst detects
// concurrent voice-track edits).
type derivedWords struct {
	words            []Word
	audio            *Audio
	observedVoiceKey string
}

// staleAgainst reports whether the locked-phase IR drifted from the state
// the phase-1 derivation assumed: a different voice key invalidates aligner
// words (TTS words carry their own fresh audio, so only the aligner path
// with a pre-existing key can go stale).
func (d *derivedWords) staleAgainst(ir *IR) bool {
	cur := ""
	if ir.Audio != nil && ir.Audio.Voice != nil {
		cur = ir.Audio.Voice.Key
	}
	return d.observedVoiceKey != cur
}

// deriveWords runs the degrade matrix (§4.10.2): Synth → Aligner(existing
// voice) → EstimateWords. Returns the chosen word source.
//
// Runs OUTSIDE any row lock (two-phase SetScript, audit P6): it mutates a
// THROWAWAY copy of the IR (the caller's phase-0 snapshot), never the
// locked row. TTS results (fresh audio + words) are self-consistent; the
// aligner path reads the observed voice key into the payload so phase 2 can
// detect drift and fall back.
func (s *ProjectService) deriveWordsUnlocked(ctx context.Context, ir *IR, script string) (*derivedWords, string, error) {
	work := &derivedWords{observedVoiceKey: ""}
	// Work on a detached copy so no phase-1 mutation can leak into the
	// locked phase's IR (the closure applies pre.audio explicitly).
	scratch := *ir
	if ir.Audio != nil && ir.Audio.Voice != nil {
		work.observedVoiceKey = ir.Audio.Voice.Key
		vc := *ir.Audio.Voice
		scratch.Audio = &Audio{Voice: &vc, BGM: ir.Audio.BGM}
	}
	if s.ports.Synth != nil {
		tctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()
		vr, serr := s.ports.Synth.Synthesize(tctx, script, scratch.voiceName(), 1.0)
		if serr != nil {
			s.log.Warn("tts synthesize failed; falling back", "err", serr)
		} else {
			if len(vr.AudioData) > 0 && s.ports.Store != nil {
				key := fmt.Sprintf("%s/assets/voice/tts-%s.mp3", scratch.voiceKeyPrefix(ctx), ids.NewV7())
				obj, perr := s.ports.Store.Put(tctx, key, "audio/mpeg", bytesReader(vr.AudioData))
				if perr == nil {
					vr.AudioKey = obj.Key
				}
			}
			words := vr.Words
			if len(words) == 0 {
				words = EstimateWords(script, vr.durationOr(scratch.Meta.DurationSec))
			} else {
				words = s.stampSource(words, WordSourceTTS)
			}
			// Fresh TTS audio rides with the words (phase 2 applies both).
			if vr.AudioKey != "" {
				if scratch.Audio == nil {
					scratch.Audio = &Audio{}
				}
				scratch.Audio.Voice = &AudioTrack{Key: vr.AudioKey, DurationSec: vr.DurationSec}
			}
			work.words = words
			work.audio = scratch.Audio
			return work, WordSourceTTS, nil
		}
	}
	if s.ports.Aligner != nil && scratch.Audio != nil && scratch.Audio.Voice != nil && scratch.Audio.Voice.Key != "" {
		tctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()
		words, aerr := s.ports.Aligner.Align(tctx, scratch.Audio.Voice.Key, script)
		if aerr == nil && len(words) > 0 {
			words = s.stampSource(words, WordSourceAligner)
			work.words = words
			work.audio = scratch.Audio // unchanged voice; audio carried for parity
			return work, WordSourceAligner, nil
		}
		if aerr != nil {
			s.log.Warn("aligner failed; falling back", "err", aerr)
		}
	}
	work.words = EstimateWords(script, scratch.Meta.DurationSec)
	work.audio = scratch.Audio // keep any pre-existing voice/bgm as observed
	return work, WordSourceEstimated, nil
}

func renumber(words []Word) {
	for i := range words {
		words[i].Index = i
		if words[i].Source == "" {
			words[i].Source = WordSourceManual
		}
	}
}

// stampSource sets the word source when unset (kept distinct from renumber so
// vendor-provided words keep their source while manual paths fill the blank).
func (s *ProjectService) stampSource(words []Word, src string) []Word {
	for i := range words {
		words[i].Index = i
		if words[i].Source == "" {
			words[i].Source = src
		}
	}
	return words
}

// voiceName picks the IR-configured voice (audio.voice.key carries it for v1;
// a dedicated field is deferred).
func (ir *IR) voiceName() string { return "" }

func (ir *IR) voiceKeyPrefix(ctx context.Context) string {
	ws := webx.PrincipalFrom(ctx)
	if ws != nil && ws.WorkspaceID != "" {
		return "video/" + ws.WorkspaceID
	}
	return "video/unknown"
}

func (vr VoiceResult) durationOr(def float64) float64 {
	if vr.DurationSec > 0 {
		return vr.DurationSec
	}
	return def
}

func bytesReader(b []byte) io.Reader { return &byteSliceReader{b: b} }

type byteSliceReader struct {
	b []byte
	i int
}

func (r *byteSliceReader) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// SetWords replaces the word table wholesale (manual/agent-refined path).
func (s *ProjectService) SetWords(ctx context.Context, p *webx.Principal, projectID string, words []Word, expectedVersion *int) (int, []AnchorResolution, error) {
	var resolutions []AnchorResolution
	newVersion, resolutions, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		renumber(words)
		ir.Words = words
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	return newVersion, resolutions, nil
}

// AddEffectAtWord appends one effect anchored at anchor{text,occurrence} and
// returns the resolvedFrom the re-resolution pass wrote (tool audit view).
func (s *ProjectService) AddEffectAtWord(ctx context.Context, p *webx.Principal, projectID string,
	anchor Anchor, typ string, params json.RawMessage, expectedVersion *int) (int, *ResolvedFrom, error) {

	var rf ResolvedFrom
	newVersion, _, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		// anchor resolution failure is an immediate 400 (§4.2.2)
		wordIndex, reason, ok := ResolveAnchors(anchor, ir.Words, -1)
		if !ok {
			return ErrAnchorNotFound
		}
		rf = ResolvedFrom{WordIndex: wordIndex, Reason: reason}
		ir.Effects = append(ir.Effects, Effect{
			ID: "fx_" + ids.NewV7().String(), Anchor: anchor, Type: typ,
			Params: params, ResolvedFrom: &rf,
		})
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	// Mutate re-resolved everything; surface the final (possibly drifted) value.
	return newVersion, &rf, nil
}

// UpsertElement inserts or replaces one element by id.
func (s *ProjectService) UpsertElement(ctx context.Context, p *webx.Principal, projectID string, el Element, expectedVersion *int) (int, []AnchorResolution, error) {
	var resolutions []AnchorResolution
	newVersion, resolutions, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		for i := range ir.Elements {
			if ir.Elements[i].ID == el.ID {
				ir.Elements[i] = el
				return nil
			}
		}
		ir.Elements = append(ir.Elements, el)
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	return newVersion, resolutions, nil
}

// MoveElement repositions one element (coords clamp at projection; §4.2.2).
func (s *ProjectService) MoveElement(ctx context.Context, p *webx.Principal, projectID, elementID string, x, y float64, expectedVersion *int) (int, error) {
	newVersion, _, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		for i := range ir.Elements {
			if ir.Elements[i].ID == elementID {
				ir.Elements[i].X, ir.Elements[i].Y = x, y
				return nil
			}
		}
		return ErrAnchorNotFound // reuse: unknown element id
	})
	if err != nil {
		return 0, err
	}
	return newVersion, nil
}

// AnimateElement appends one start-anchored animation to an element.
func (s *ProjectService) AnimateElement(ctx context.Context, p *webx.Principal, projectID, elementID string,
	an ElementAnimation, expectedVersion *int) (int, *ResolvedFrom, error) {

	newVersion, _, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		for i := range ir.Elements {
			if ir.Elements[i].ID != elementID {
				continue
			}
			if an.StartAnchor != nil {
				if _, _, ok := ResolveAnchors(*an.StartAnchor, ir.Words, -1); !ok {
					return ErrAnchorNotFound
				}
			}
			if an.ID == "" {
				an.ID = "an_" + ids.NewV7().String()
			}
			ir.Elements[i].Animations = append(ir.Elements[i].Animations, an)
			return nil
		}
		return ErrAnchorNotFound
	})
	if err != nil {
		return 0, nil, err
	}
	return newVersion, nil, nil
}

// SetAudio replaces the voice/bgm pair.
func (s *ProjectService) SetAudio(ctx context.Context, p *webx.Principal, projectID string, audio *Audio, expectedVersion *int) (int, error) {
	newVersion, _, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		ir.Audio = audio
		return nil
	})
	if err != nil {
		return 0, err
	}
	return newVersion, nil
}

// SubmitRender is the render gate (§4.6 order, fixed): CapAvailable check →
// quota ConsumeWith(idempotency=renderID) → INSERT video_render(queued,
// ir_snapshot) → Enqueue → audit. Reversing any two steps breaks the
// fail-closed property (a queued row with no quota, or spent quota with no
// row).
func (s *ProjectService) SubmitRender(ctx context.Context, p *webx.Principal, projectID string, params RenderParams, expectedVersion *int, submissionKey string) (*Render, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	// 1. capability gate BEFORE any side effect
	if s.ports.Cap == nil || !s.ports.Cap.CapAvailable() {
		return nil, ErrNotConfigured
	}
	// snapshot the project (also validates ownership)
	pr, err := s.Get(ctx, p, projectID)
	if err != nil {
		return nil, err
	}
	if expectedVersion != nil && *expectedVersion != pr.Version {
		return nil, conflict(pr.Version)
	}
	params.normalize(pr.IR)

	// 2. ONE transaction for the whole submission (audit Â§4 P2): quota
	// charge (idem-keyed) + render row + river job + audit commit or roll
	// back together â no window where quota is spent without a row,
	// or a row exists without a charge.
	period := quota.Period(s.now())
	renderID := ids.NewV7().String()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if s.ports.Quota != nil {
		if qerr := s.ports.Quota.ConsumeWithTx(ctx, tx, p.WorkspaceID, QuotaKey, 1, s.now(), submissionKey); qerr != nil {
			if errors.Is(qerr, quota.ErrIdemReplay) {
				// Duplicate submission (network retry / agent double-call):
				// return the row the first submission created instead of an
				// error â the agent sees its render, no double charge.
				tx.Rollback(ctx)
				return s.renderBySubmissionKey(ctx, p.WorkspaceID, submissionKey)
			}
			return nil, qerr
		}
	}
	var r Render
	err = tx.QueryRow(ctx, `
		INSERT INTO video_render (id, project_id, workspace_id, status, params, ir_snapshot, frames_total, created_by, submission_key, quota_period)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id, project_id, workspace_id, status, params, frames_done, frames_total, output_key, error,
		          created_by, created_at, updated_at, finished_at`,
		renderID, projectID, p.WorkspaceID, RenderQueued, mustJSON(params), irBytes(pr.IR),
		DurationFrames(pr.IR, params.FPS), p.UserID, submissionKey, period).
		Scan(&r.ID, &r.ProjectID, &r.Workspace, &r.Status, &paramsDest{&r.Params}, &r.FramesDone, &r.FramesTotal,
			&r.OutputKey, &r.Error, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt, &r.FinishedAt)
	if err != nil {
		// The (workspace_id, submission_key) unique index rejects a duplicate
		// when quota is not wired (or key set but quota nil): same replay
		// contract as the idem table.
		if submissionKey != "" && pg.IsUniqueViolation(err, "uq_video_render_submission") {
			tx.Rollback(ctx)
			return s.renderBySubmissionKey(ctx, p.WorkspaceID, submissionKey)
		}
		return nil, err
	}
	if s.ports.Enqueue != nil {
		if eerr := s.ports.Enqueue.InsertTx(ctx, tx, RenderArgs{RenderID: renderID},
			&river.InsertOpts{Queue: RenderQueue}); eerr != nil {
			return nil, eerr
		}
	}
	if s.ports.Audit != nil {
		if aerr := s.ports.Audit.RecordTx(ctx, tx, &p.WorkspaceID, p.UserID,
			AuditRenderCreated, "video_render", renderID,
			map[string]any{"project_id": projectID, "origin": originOf(ctx), "idempotent": submissionKey != ""}); aerr != nil {
			return nil, aerr
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &r, nil
}

// renderBySubmissionKey loads the render a previous submission with the
// same idempotency key created (replay path).
func (s *ProjectService) renderBySubmissionKey(ctx context.Context, wsID, key string) (*Render, error) {
	var r Render
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id, workspace_id, status, params, frames_done, frames_total, output_key, error,
		       created_by, created_at, updated_at, finished_at
		FROM video_render WHERE workspace_id=$1 AND submission_key=$2`, wsID, key).
		Scan(&r.ID, &r.ProjectID, &r.Workspace, &r.Status, &paramsDest{&r.Params}, &r.FramesDone, &r.FramesTotal,
			&r.OutputKey, &r.Error, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt, &r.FinishedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// DurationFrames is the SINGLE source of the frame-count formula (audit
// Â§4 P8: Go truncated on meta-only, Go truncated on voice-extended, and JS
// rounded on voice-extended â three diverging calendars for one number):
//
//	ceil(max(meta.durationSec, voice.durationSec) * fps), at least 1
//
// The voice duration extends the timeline when it runs past meta; every
// consumer (service persistence, worker fallback, pipeline fallback, and
// timeline-builder.js â which must Math.ceil the same value) derives its
// number from this definition.
func DurationFrames(ir *IR, fps int) int {
	if fps <= 0 {
		fps = ir.Meta.FPS
	}
	d := ir.Meta.DurationSec
	if ir.Audio != nil && ir.Audio.Voice != nil && ir.Audio.Voice.DurationSec > d {
		d = ir.Audio.Voice.DurationSec
	}
	n := int(math.Ceil(d * float64(fps)))
	if n < 1 {
		n = 1
	}
	return n
}

// paramsDest adapts *RenderParams for row scanning.
type paramsDest struct{ dst *RenderParams }

func (d paramsDest) Scan(src any) error {
	b, ok := src.([]byte)
	if !ok && src != nil {
		return fmt.Errorf("params column not []byte")
	}
	if len(b) > 0 {
		if err := json.Unmarshal(b, d.dst); err != nil {
			return err
		}
	}
	return nil
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// GetRender loads one render (membership enforced through the workspace).
func (s *ProjectService) GetRender(ctx context.Context, p *webx.Principal, renderID string) (*Render, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	var r Render
	err := s.pool.QueryRow(ctx, `
		SELECT id, project_id, workspace_id, status, params, frames_done, frames_total,
		       output_key, error, created_by, created_at, updated_at, finished_at
		FROM video_render WHERE id=$1 AND workspace_id=$2`, renderID, p.WorkspaceID).
		Scan(&r.ID, &r.ProjectID, &r.Workspace, &r.Status, &paramsDest{&r.Params}, &r.FramesDone, &r.FramesTotal,
			&r.OutputKey, &r.Error, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt, &r.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRenderNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ListRenders lists a project's render history, newest first.
func (s *ProjectService) ListRenders(ctx context.Context, p *webx.Principal, projectID string) ([]Render, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, project_id, workspace_id, status, params, frames_done, frames_total,
		       output_key, error, created_by, created_at, updated_at, finished_at
		FROM video_render WHERE project_id=$1 AND workspace_id=$2
		ORDER BY created_at DESC LIMIT 100`, projectID, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Render{}
	for rows.Next() {
		var r Render
		var pd RenderParams
		r.Params = pd
		if err := rows.Scan(&r.ID, &r.ProjectID, &r.Workspace, &r.Status, &paramsDest{&r.Params}, &r.FramesDone, &r.FramesTotal,
			&r.OutputKey, &r.Error, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt, &r.FinishedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CanAccess exposes the membership check for the file handler (key-derived
// workspace — the project row is not loaded).
func (s *ProjectService) CanAccess(ctx context.Context, p *webx.Principal, wsID string) (bool, error) {
	return s.canAccess(ctx, wsID, p.UserID, p.IsPlatformAdmin)
}

// Projector lazily constructs the preview projector (PreviewResolver).
func (s *ProjectService) ProjectHTML(ctx context.Context, ir *IR) ([]byte, error) {
	return NewProjector(PreviewResolver{}).HTML(ctx, ir, "")
}

// UploadAsset persists one asset under the content-addressed layout
// (§4.9.4): video/<wsID>/assets/<projectID>/<sha256>.<ext>. Idempotent per
// content. Returns the storage key.
func (s *ProjectService) UploadAsset(ctx context.Context, p *webx.Principal, projectID, filename, contentType string, data []byte) (string, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return "", aerr
	}
	if !ok {
		return "", ErrForbidden
	}
	if len(data) > UploadLimit {
		return "", ErrAssetTooLarge
	}
	switch contentType {
	case "image/png", "image/jpeg", "image/gif", "image/webp",
		"audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav":
	default:
		return "", ErrAssetUnsupported
	}
	if s.ports.Store == nil {
		return "", fmt.Errorf("video: storage port not wired")
	}
	ext := "bin"
	switch contentType {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	case "image/gif":
		ext = "gif"
	case "image/webp":
		ext = "webp"
	case "audio/mpeg":
		ext = "mp3"
	case "audio/mp4":
		ext = "m4a"
	case "audio/wav", "audio/x-wav":
		ext = "wav"
	}
	sha := sha256Hex(data)
	key := fmt.Sprintf("video/%s/assets/%s/%s.%s", p.WorkspaceID, projectID, sha, ext)
	obj, err := s.ports.Store.Put(ctx, key, contentType, bytesReader(data))
	if err != nil {
		return "", err
	}
	if s.ports.Audit != nil {
		s.ports.Audit.Record(ctx, &p.WorkspaceID, p.UserID, AuditAssetUploaded, "video_asset", obj.Key,
			map[string]any{"size": obj.Size, "origin": originOf(ctx)})
	}
	return obj.Key, nil
}
