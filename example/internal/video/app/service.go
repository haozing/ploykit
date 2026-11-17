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
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
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
	// ErrRenderActive blocks project deletion while a render is queued/running:
	// the render row cascades away with the project, which would strand the
	// river job, lose the terminal state and silently keep the quota spent
	// (delivery audit P1). Reserved in the contract since v1.
	ErrRenderActive = webx.NewError(409, "E_VIDEO_RENDER_ACTIVE", "a render is queued or running for this project; wait for it to finish or fail before deleting")
	ErrNotConfigured    = webx.NewError(503, "E_NOT_CONFIGURED", "render capability not configured")
	ErrForbidden        = webx.NewError(403, "E_FORBIDDEN", "not a member of this workspace")
	ErrInternalPreview  = webx.NewError(500, "E_VIDEO_PREVIEW_INTERNAL", "preview CSP hash unavailable")
	ErrAssetTooLarge    = webx.NewError(400, "E_VIDEO_ASSET_TOO_LARGE", "asset exceeds the size limit")
	ErrAssetUnsupported = webx.NewError(400, "E_VIDEO_ASSET_UNSUPPORTED", "asset content type not allowed")
	// ErrAssetMismatch carries the SAME contract code as ErrAssetUnsupported
	// (400 E_VIDEO_ASSET_UNSUPPORTED — the declared type is not servable)
	// with a distinct message: the magic-byte check found the declared
	// content type does not match the file header (agent2 P2-5, 防伪装文件).
	ErrAssetMismatch = webx.NewError(400, "E_VIDEO_ASSET_UNSUPPORTED",
		"file content does not match the declared content type (magic-byte check)")
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

// UploadLimit is the asset size cap for the MCP base64 upload path (~700KB
// inside the /mcp 1MiB body limit — base64 inflates 4/3, so 700KB raw ≈ 933KB
// on the wire). Large assets go through the REST multipart endpoint, which
// main.go gates at 50MiB (BodyLimitExcept + 120s timeout) and whose service
// cap is UploadLimitLarge below. The two-channel split (e2e agent2 P2-3):
// one shared ~1MiB cap made the REST channel's 50MB body-limit exemption
// dead code and rejected ~2MB PNGs the documented escape hatch promised to
// accept.
const UploadLimit = 700 << 10

// UploadLimitLarge is the REST multipart asset cap — matched to main.go's
// webx.BodyLimitExcept(50<<20, "/api/video/assets") so the route's body-limit
// exemption is real end to end (parse gate and service gate agree).
const UploadLimitLarge = 50 << 20

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

// renderParamInvalid maps a render-parameter range violation to the 400 the
// REST/MCP surfaces share (same fieldMsg shape as the E_VIDEO_IR_INVALID
// family; the code is distinct because these are render-time overrides, not
// IR shape errors).
func renderParamInvalid(field, msg string) error {
	return webx.NewError(400, "E_VIDEO_RENDER_PARAMS_INVALID", fieldMsg(field, msg))
}

// validate enforces the render-parameter ranges SubmitRender accepts (e2e
// agent3 Bug-3: bgm_volume=1.5 and fps=23 were silently persisted and
// rendered — params must fail closed instead of being coerced).
//
// Runs BEFORE the project snapshot / normalize: it is a pure check (no IR,
// no pool) so a bad submission is rejected before any quota/tx side effect,
// and fps=0 stays the documented "inherit the project fps" sentinel here.
// Width/height keep their own even-and-range validation in Validate — not
// duplicated.
func (p *RenderParams) validate() error {
	if p.BGMVolume < 0 || p.BGMVolume > 1 {
		return renderParamInvalid("params.bgm_volume", "must be between 0 and 1")
	}
	if p.FPS != 0 && !validFPS[p.FPS] {
		return renderParamInvalid("params.fps",
			"unsupported (valid: 24, 25, 30, 50, 60, or 0 to inherit the project's fps)")
	}
	// Size override bounds. The viewport is driven straight into Chrome and
	// the frame size into ffmpeg, so an unbounded request (width=100000) is a
	// cheap way to exhaust host memory/tmp for the whole pool (delivery audit
	// P2). Bounds match the IR canvas range; odd values stay rejected by
	// FrameSpec.Validate.
	for _, d := range []struct {
		field string
		v     int
	}{{"params.width", p.Width}, {"params.height", p.Height}} {
		if d.v == 0 {
			continue // 0 = inherit the project's canvas
		}
		if d.v < MinCanvasDim || d.v > MaxCanvasDim {
			return renderParamInvalid(d.field,
				fmt.Sprintf("must be 0 (inherit) or between %d and %d", MinCanvasDim, MaxCanvasDim))
		}
	}
	if p.Width != 0 && p.Height != 0 && p.Width*p.Height > MaxCanvasPixels {
		return renderParamInvalid("params.width",
			fmt.Sprintf("canvas area must not exceed %d pixels", MaxCanvasPixels))
	}
	return nil
}

// Canvas bounds shared by the IR validator and the render-parameter gate.
const (
	MinCanvasDim = 64
	MaxCanvasDim = 4096
	// MaxCanvasPixels caps the total raster area (4096x4096 = 16.7M px keeps
	// 4K portrait 2160x3840 comfortable while refusing absurd combinations).
	MaxCanvasPixels = 4096 * 4096
	// MaxRenderDurationSec bounds the film length: the snapshot walk and the
	// render both scale with it, so an unbounded meta.duration_sec let a
	// single write pin the pool for a very long time (delivery audit P2).
	MaxRenderDurationSec = 600
)

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
	// OutputURL/ThumbURL are REST-derived convenience fields required by the
	// openapi VideoRender schema: direct /api/video/files/ links for the
	// finished MP4 and its first-frame thumbnail. MCP video_get_render has
	// always assembled the same prefix inline; the REST rows were missing it
	// (caught by the UI walkthrough — the download column rendered "—").
	OutputURL  string     `json:"output_url,omitempty"`
	ThumbURL   string     `json:"thumb_url,omitempty"`
	Error      string     `json:"error"`
	CreatedBy  string     `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`

	// submissionKey/quotaPeriod serve idempotency and period-fixed release
	// (migration 1009); not part of the API payload.
	submissionKey string
	quotaPeriod   string
	releasedAt    *time.Time
}

// Asset is the REST-facing projection of one video_asset registry row
// (migration 1011, F-AUTH-01/F-TRA-01): the DB ownership credential for an
// uploaded storagex object. Render outputs are NOT registered here — the
// video_render row itself is their ownership credential.
type Asset struct {
	ID          string    `json:"id"`
	Workspace   string    `json:"workspace_id"`
	ProjectID   string    `json:"project_id"`
	Key         string    `json:"key"`
	Kind        string    `json:"kind"`
	Bytes       int64     `json:"bytes"`
	SHA256      string    `json:"sha256"`
	ContentType string    `json:"content_type"`
	CreatedAt   time.Time `json:"created_at"`
}

// Asset kinds (migration 1011 kind column).
const (
	AssetKindImage = "image"
	AssetKindAudio = "audio"
)

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

	// 剧本→视频生成器（2026-11 批次）：合成器/分卡摘要/目录数据源由
	// scriptgen/template 包经 WithScriptComposer / WithTemplateCatalog
	// 注入（app 不能 import 它们——包环）；nil = 能力未接线。
	composer        ScriptComposer
	cardSplitter    CardSplitter
	templateCatalog func() []TemplateCatalogEntry
	themeCatalog    func() []ThemeCatalogEntry
}

func NewProjectService(pool *pgxpool.Pool, ports Ports, log *slog.Logger) *ProjectService {
	if log == nil {
		log = slog.Default()
	}
	return &ProjectService{pool: pool, ports: ports, log: log, now: time.Now}
}

// SetClock overrides the time source (tests).
func (s *ProjectService) SetClock(now func() time.Time) { s.now = now }

// uuidShape guards the id-typed SQL entry points (e2e agent1/2: a malformed
// id reached Postgres's uuid cast as E_INTERNAL 500). A non-UUID id parses
// to nothing here and returns the same 404 a missing row would (no existence
// leak, no enumeration oracle — the "not found" shape is identical).
func uuidShape(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

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

// RequirePerm enforces the workspace role matrix for one permission on the
// principal's current workspace. REST handlers get this from authz.Require at
// the mount; the MCP face has no such middleware, so its tools call this
// explicitly (delivery audit P1).
//
// Semantics mirror authz.CanIn: a PAT's declared scope is necessary but NOT
// sufficient (the role matrix still decides), platform admins bypass the role
// matrix, and an unwired Authorizer port denies fail-closed in production
// wiring rather than silently allowing.
func (s *ProjectService) RequirePerm(ctx context.Context, p *webx.Principal, perm string) error {
	if p == nil {
		return ErrForbidden
	}
	if p.WorkspaceID == "" {
		return ErrForbidden
	}
	// 1. The credential's own scope must allow the workspace AND the perm.
	if !p.Scope.AllowsWorkspace(p.WorkspaceID) || !p.Scope.AllowsPermission(perm) {
		return ErrForbidden
	}
	if p.IsPlatformAdmin {
		return nil
	}
	// 2. Resolve the role (PAT principals carry none) and consult the shared
	//    role matrix. Without this a write-scoped PAT would satisfy every
	//    permission its scope names, regardless of the role.
	if s.ports.Authz != nil {
		role := p.Role
		if role == "" && s.ports.Membership != nil {
			r, ok, err := s.ports.Membership.RoleOf(ctx, p.WorkspaceID, p.UserID)
			if err != nil {
				return err
			}
			if !ok {
				return ErrForbidden
			}
			role = r
		}
		if role == "" {
			return ErrForbidden
		}
		resolved := *p
		resolved.Role = role
		if !s.ports.Authz.CanIn(ctx, &resolved, perm) {
			return ErrForbidden
		}
		return nil
	}
	// 3. No authorizer wired (pure-port tests): membership is the only gate.
	if !p.IsPlatformAdmin && s.ports.Membership != nil {
		ok, err := s.ports.Membership.IsMember(ctx, p.WorkspaceID, p.UserID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrForbidden
		}
	}
	return nil
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
	// Malformed id → 404 semantics before any SQL (uuidShape; a raw cast would
	// surface E_INTERNAL to UpsertElement/MoveElement/AnimateElement/SetAudio/
	// AddEffectAtWord/SetWords callers). Kept AFTER the membership gate — the
	// write path's documented first gate is membership (403), unlike Get's
	// workspace-predicate-first read shape.
	if !uuidShape(projectID) {
		return 0, nil, ErrProjectNotFound
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
	// Asset-reference existence check (§8.5a.2 ruling, option B): a dangling
	// image src is rejected at write time, mirroring the targetElementId
	// precedent (fail-fast at commit, no render row, no quota spend). Runs
	// AFTER the pure Validate so field-shape errors keep their precedence.
	if rerr := s.validateAssetRefs(ctx, p.WorkspaceID, ir); rerr != nil {
		return 0, nil, rerr
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

// validateAssetRefs enforces write-time existence for every image element src
// and every audio track key (§8.5a.2 proposal, option B adopted; audio side is
// G-01c — the batch-G plan's finding that validateAudio checked key SHAPE only
// while an unregistered BGM failed a full render cycle later at the worker's
// tempFile fetch): a reference must trace to a video_asset
// registry row (the migration-1011 ownership credential — the same query
// CanAccessKey runs for the serving gate), OR the storagex object itself must
// exist. The OR branch is the legacy-compatibility window: assets uploaded
// before round 8 have no registry row, and rejecting them would break every
// existing project's IR on its next edit. The window is one-directional — new
// uploads always register (UploadAsset aborts on a failed registration), so
// the row branch covers everything created after round 8 and the storage
// probe only serves the stock. Returns E_VIDEO_IR_INVALID with
// details.field = elements[N].src / audio.voice.key / audio.bgm.key so HTTP
// and MCP surface the same detail as every other IR validation failure.
//
// The storage probe costs one Open on the local backend (stat-like) or one
// GetObject head on S3; elements are capped at MaxElements (64) and audio
// adds at most 2 keys, so the worst-case probe count per write is bounded and
// only reached when NO reference is registered — the legacy window, not the
// steady state. DB is consulted first and short-circuits per key (one
// statement per distinct reference; the common case is 0-2 image elements
// per project).
func (s *ProjectService) validateAssetRefs(ctx context.Context, wsID string, ir *IR) error {
	if s.pool == nil {
		// Nil-pool unit contexts exercise the pure paths only; existence is
		// unknowable without the registry, so fail open here (Mutate itself
		// cannot run without a pool anyway — this keeps direct callers safe).
		return nil
	}
	for i := range ir.Elements {
		el := &ir.Elements[i]
		if el.Type != ElementImage || el.Src == "" {
			continue
		}
		if err := s.assetRefExists(ctx, wsID, el.Src,
			fmt.Sprintf("elements[%d].src", i)); err != nil {
			return err
		}
	}
	// Audio tracks (G-01c): same registry-or-storage contract as image src.
	// SetAudio's MCP tool pre-checks CanAccessKey before the mutate, so this
	// gate is the backstop for the REST/PUT-IR surfaces.
	if ir.Audio != nil {
		for _, t := range []struct {
			field string
			track *AudioTrack
		}{
			{"audio.voice.key", ir.Audio.Voice},
			{"audio.bgm.key", ir.Audio.BGM},
		} {
			if t.track == nil || t.track.Key == "" {
				continue
			}
			if err := s.assetRefExists(ctx, wsID, t.track.Key, t.field); err != nil {
				return err
			}
		}
	}
	return nil
}

// assetRefExists enforces the registry-or-storage contract for one reference
// (image src or audio key). Field feeds the E_VIDEO_IR_INVALID details.field
// surface (same shape as every pure Validate error).
func (s *ProjectService) assetRefExists(ctx context.Context, wsID, key, field string) error {
	// Registry first (the round-8+ path; also the ownership credential).
	var n int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM video_asset WHERE key=$1 AND workspace_id=$2`,
		key, wsID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	// Legacy window: unregistered but physically present. A storage
	// failure reads as absence (fail-closed: the write is rejected with
	// the same "asset not registered" verdict — a flaky backend must not
	// silently admit a reference that cannot be served).
	//
	// TENANT GATE: the storage probe is only meaningful for objects inside
	// this workspace's key prefix. Without it, an object that physically
	// exists under another tenant's prefix (whose key a caller learned from
	// history, logs or a public asset) would be admitted and then inlined
	// into this tenant's captures/renders — the registry row is the
	// ownership credential, storage presence is not (delivery audit P1).
	if s.ports.Store != nil && strings.HasPrefix(key, "video/"+wsID+"/") {
		body, _, oerr := s.ports.Store.Open(ctx, key)
		if oerr == nil {
			if body != nil {
				body.Close()
			}
			return nil
		}
		if !errors.Is(oerr, os.ErrNotExist) {
			s.log.Warn("video src existence probe failed; rejecting as unregistered",
				"key", key, "err", oerr)
		}
	}
	return webx.NewError(400, "E_VIDEO_IR_INVALID",
		fieldMsg(field, "asset not registered (upload via video_upload_asset / POST /api/video/assets first)"))
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
	// Malformed id reads as the generic 404 (uuidShape; same shape as a
	// missing row — no 500, no enumeration oracle).
	if !uuidShape(projectID) {
		return nil, ErrProjectNotFound
	}
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

// Delete removes a project (renders and registered assets cascade via FK).
// After the commit the registered asset objects are deleted from storagex
// (synchronous, best-effort: a failed delete only warns — storagex Local
// treats a missing object as success and the reference list is gone with the
// rows, so a missed object degrades to a storage-side orphan, not a
// readable-but-unauthorized one: the next access loses its registry row).
func (s *ProjectService) Delete(ctx context.Context, p *webx.Principal, projectID string) error {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return aerr
	}
	if !ok {
		return ErrForbidden
	}
	// Malformed id → 404 semantics before any SQL (uuidShape), after the
	// documented membership-first write gate (same shape as Mutate).
	if !uuidShape(projectID) {
		return ErrProjectNotFound
	}
	// Refuse while a render is in flight: video_render.project_id is ON DELETE
	// CASCADE, so deleting now would erase the row the worker is writing to
	// (ErrTerminalSkip), orphan the river job, and permanently keep the quota
	// spend with no row left to reconcile (delivery audit P1). The caller can
	// cancel/wait and retry.
	var active int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM video_render
		 WHERE project_id=$1 AND workspace_id=$2 AND status IN ('queued','running','interrupted')`,
		projectID, p.WorkspaceID).Scan(&active); err != nil {
		return err
	}
	if active > 0 {
		return ErrRenderActive
	}
	// Collect the asset keys BEFORE the delete: once video_asset rows
	// cascade, the reference list is unrecoverable (render outputs keep
	// their rows' trace in the audit trail, so only asset keys are needed).
	keys, kerr := s.assetKeysForProject(ctx, p.WorkspaceID, projectID)
	if kerr != nil {
		s.log.Warn("video delete: asset key collection failed; storage objects may orphan", "project_id", projectID, "err", kerr)
		keys = nil
	}
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM video_project WHERE id=$1 AND workspace_id=$2`, projectID, p.WorkspaceID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrProjectNotFound
	}
	// Delete IS an audited lifecycle event (v2.0 §13): renders cascade via
	// FK, so this record is the only trace the project ever existed.
	if s.ports.Audit != nil {
		s.ports.Audit.Record(ctx, &p.WorkspaceID, p.UserID,
			AuditProjectDeleted, "video_project", projectID,
			map[string]any{"asset_objects": len(keys)})
	}
	// Storage sweep AFTER the DB rows are gone (same commit ordering as the
	// registry: DB first, object second — a crash between the two leaves an
	// unreachable object, never an authorized-but-missing one).
	if len(keys) > 0 && s.ports.Store != nil {
		if derr := s.ports.Store.DeleteMulti(ctx, keys...); derr != nil {
			// Soft-delete semantics acceptable: storage is eventually
			// consistent and the keys lost their registry rows, so the
			// objects can no longer be served through /api/video/files.
			s.log.Warn("video delete: storage sweep failed; objects orphaned in storage", "project_id", projectID, "err", derr)
		}
	}
	return nil
}

// assetKeysForProject lists the storage keys registered for one project
// (the video_asset reference list, migration 1011). Called before the
// project delete cascades the rows away.
func (s *ProjectService) assetKeysForProject(ctx context.Context, wsID, projectID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT key FROM video_asset WHERE project_id=$1 AND workspace_id=$2`, projectID, wsID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
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
	// Fresh TTS voice key adopted into the IR: the storage object exists, so
	// its video_asset row must too (F-AUTH-01) — otherwise the preview/render
	// download of the voice key fails CanAccessKey. Written after the mutate
	// committed; the scratch object outlives a failed registration (the row
	// is re-attempted on the next SetScript, which re-derives the voice).
	if pre.ttsAsset != nil {
		if rerr := s.registerAsset(ctx, nil, p.WorkspaceID, projectID,
			pre.ttsAsset.key, AssetKindAudio, pre.ttsAsset.size, pre.ttsAsset.sha,
			pre.ttsAsset.contentType); rerr != nil {
			s.log.Warn("setscript: tts voice asset registration failed", "project_id", projectID, "err", rerr)
		}
	}
	return newVersion, resolutions, source, nil
}

// derivedWords is the phase-1 payload: the words/audio computed outside the
// lock, plus the observation they were based on (staleAgainst detects
// concurrent voice-track edits). ttsAsset carries the storage facts of a
// freshly persisted TTS voice so the locked phase can write its video_asset
// registry row in the same transaction that adopts the key into the IR.
type derivedWords struct {
	words            []Word
	audio            *Audio
	observedVoiceKey string
	ttsAsset         *ttsAssetMeta
}

// ttsAssetMeta is the video_asset registration payload for one fresh TTS
// voice object (migration 1011).
type ttsAssetMeta struct {
	key         string
	size        int64
	sha         string
	contentType string
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
					// Registry facts for the SetScript locked phase: the TTS
					// scratch object needs its video_asset row (F-AUTH-01 —
					// otherwise the fresh voice key fails CanAccessKey and
					// the preview/render download breaks).
					work.ttsAsset = &ttsAssetMeta{
						key:         obj.Key,
						size:        obj.Size,
						sha:         sha256Hex(vr.AudioData),
						contentType: "audio/mpeg",
					}
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
// targetElementID optionally binds the effect to an existing element
// (validated by IR Validate — a dangling id fails the write with
// E_VIDEO_IR_INVALID details.field=targetElementId).
func (s *ProjectService) AddEffectAtWord(ctx context.Context, p *webx.Principal, projectID string,
	anchor Anchor, typ string, params json.RawMessage, targetElementID string, expectedVersion *int) (int, *ResolvedFrom, error) {

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
			Params: params, TargetElementID: targetElementID, ResolvedFrom: &rf,
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

// ErrElementNotFound is the precise code for "element id does not exist".
// MoveElement/AnimateElement used to reuse ErrAnchorNotFound ("anchor text not
// found in words"), which sent agents off to rewrite the script instead of
// fixing the id (delivery audit P2).
var ErrElementNotFound = webx.NewError(404, "E_VIDEO_ELEMENT_NOT_FOUND", "element not found in this project")

// RemoveElement deletes one element by id.
//
// The hand-editing path had create/update/move/animate but no delete, so an
// element added by mistake could only be removed by re-composing the whole IR
// (losing every other hand tweak) — plan G-05, P1.
func (s *ProjectService) RemoveElement(ctx context.Context, p *webx.Principal, projectID, elementID string, expectedVersion *int) (int, error) {
	if elementID == "" {
		return 0, ErrElementNotFound
	}
	newVersion, _, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		for i := range ir.Elements {
			if ir.Elements[i].ID == elementID {
				ir.Elements = append(ir.Elements[:i], ir.Elements[i+1:]...)
				return nil
			}
		}
		return ErrElementNotFound
	})
	if err != nil {
		return 0, err
	}
	return newVersion, nil
}

// SetMeta updates the canvas/timing metadata (width/height/fps/durationSec).
//
// Zero fields are left unchanged, so a caller can adjust one value without
// restating the others. Duration is bounded by Validate like every other write
// path, and fps must be one of the supported rates.
func (s *ProjectService) SetMeta(ctx context.Context, p *webx.Principal, projectID string, meta MetaPatch, expectedVersion *int) (int, error) {
	newVersion, _, err := s.Mutate(ctx, p, projectID, expectedVersion, func(ir *IR) error {
		if meta.Width != nil {
			ir.Meta.Width = *meta.Width
		}
		if meta.Height != nil {
			ir.Meta.Height = *meta.Height
		}
		if meta.FPS != nil {
			ir.Meta.FPS = *meta.FPS
		}
		if meta.DurationSec != nil {
			ir.Meta.DurationSec = *meta.DurationSec
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return newVersion, nil
}

// MetaPatch is the partial update SetMeta accepts (nil = leave unchanged).
type MetaPatch struct {
	Width       *int
	Height      *int
	FPS         *int
	DurationSec *float64
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
	// 1b. render-parameter range gate (e2e agent3 Bug-3): pure check, no pool
	// touch — a bad submission must fail closed before the quota transaction.
	if perr := params.validate(); perr != nil {
		return nil, perr
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
	if !uuidShape(renderID) {
		return nil, ErrRenderNotFound
	}
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
	r.deriveURLs()
	return &r, nil
}

// deriveURLs fills the REST convenience fields from OutputKey (openapi
// VideoRender schema). Thumb: the pipeline writes <render>/thumb.png next to
// output.mp4 (§4.9.6 — first frame of the encoded deliverable via
// capx.ExtractFrameAt); absent when the render never succeeded or the
// best-effort extraction failed.
func (r *Render) deriveURLs() {
	if r.OutputKey != "" {
		r.OutputURL = "/api/video/files/" + r.OutputKey
		if thumb := strings.Replace(r.OutputKey, "output.mp4", "thumb.png", 1); thumb != r.OutputKey {
			r.ThumbURL = "/api/video/files/" + thumb
		}
	}
}

// ListRenders lists a project's render history, newest first.
func (s *ProjectService) ListRenders(ctx context.Context, p *webx.Principal, projectID string) ([]Render, error) {
	if !uuidShape(projectID) {
		return nil, ErrProjectNotFound
	}
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
		r.deriveURLs()
		out = append(out, r)
	}
	return out, rows.Err()
}

// CanAccess exposes the membership check for the file handler (key-derived
// workspace — the project row is not loaded).
func (s *ProjectService) CanAccess(ctx context.Context, p *webx.Principal, wsID string) (bool, error) {
	return s.canAccess(ctx, wsID, p.UserID, p.IsPlatformAdmin)
}

// CanAccessProject answers the WS-subscription question: "may this principal
// follow live events for this PROJECT".
//
// The previous wiring passed the project id straight into CanAccess, which
// treats its argument as a WORKSPACE id — so the membership query looked for a
// workspace whose id equalled the project id and rejected every non-platform
// admin (the video live feed was dead for all real users). It also never
// checked the video:read permission. This resolves project → workspace first,
// then applies the same membership + role rules as the REST surface.
func (s *ProjectService) CanAccessProject(ctx context.Context, p *webx.Principal, projectID string) (bool, error) {
	if p == nil || !uuidShape(projectID) {
		return false, nil
	}
	var wsID string
	err := s.pool.QueryRow(ctx,
		`SELECT workspace_id FROM video_project WHERE id=$1`, projectID).Scan(&wsID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// The credential must cover the workspace the project actually lives in.
	if !p.Scope.AllowsWorkspace(wsID) {
		return false, nil
	}
	ok, aerr := s.canAccess(ctx, wsID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil || !ok {
		return false, aerr
	}
	// Role layer: live IR/render frames are read-equivalent. A principal that
	// may not read the project must not watch it either.
	resolved := *p
	resolved.WorkspaceID = wsID
	if s.ports.Authz != nil {
		role := p.Role
		if role == "" && s.ports.Membership != nil {
			r, mok, rerr := s.ports.Membership.RoleOf(ctx, wsID, p.UserID)
			if rerr != nil {
				return false, rerr
			}
			if !mok {
				return false, nil
			}
			role = r
		}
		resolved.Role = role
		if !s.ports.Authz.CanIn(ctx, &resolved, "video:read") {
			return false, nil
		}
	}
	return true, nil
}

// Projector lazily constructs the preview projector (PreviewResolver).
func (s *ProjectService) ProjectHTML(ctx context.Context, ir *IR) ([]byte, error) {
	return NewProjector(PreviewResolver{}).HTML(ctx, ir, "")
}

// UploadAsset persists one asset under the content-addressed layout
// (§4.9.4): video/<wsID>/assets/<projectID>/<sha256>.<ext>. Idempotent per
// content. Returns the storage key. The upload also writes one video_asset
// registry row (migration 1011, F-AUTH-01): the row is the ownership
// credential the file handler checks — workspace membership alone no longer
// grants read on any key. MCP video_upload_asset and REST /api/video/assets
// share this method, so both surfaces register.
//
// limit is the CHANNEL cap (e2e agent2 P2-3): the MCP base64 tool passes
// UploadLimit (~700KB — /mcp body limit), the REST multipart handler passes
// UploadLimitLarge (50MB — matched to main.go's BodyLimitExcept). The size
// gate runs before any storage/registry write.
//
// Magic-byte sniffing (e2e agent2 P2-5): the declared content type must
// match the file header — a 5-byte "hello" posing as image/png is rejected
// instead of being registered as an image asset. Both channels share the
// gate (the MCP tool sniffs content-type from the filename when omitted;
// the REST handler takes the multipart part's declared type).
func (s *ProjectService) UploadAsset(ctx context.Context, p *webx.Principal, projectID, filename, contentType string, data []byte, limit int64) (string, error) {
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return "", aerr
	}
	if !ok {
		return "", ErrForbidden
	}
	if int64(len(data)) > limit {
		return "", ErrAssetTooLarge
	}
	switch contentType {
	case "image/png", "image/jpeg", "image/gif", "image/webp",
		"audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav":
	default:
		return "", ErrAssetUnsupported
	}
	if !uuidShape(projectID) {
		// Malformed id → 404 semantics before any content/storage work
		// (uuidShape; the EXISTS probe below would otherwise surface the
		// bad id as a 500). Consistent with Get: identity first, body
		// validation after.
		return "", ErrProjectNotFound
	}
	// Magic mismatch = the declared type is a lie (agent2 P2-5): reject with
	// the same 400 family, message distinguishes the cause.
	if !magicMatches(contentType, data) {
		return "", ErrAssetMismatch
	}
	if s.ports.Store == nil {
		return "", fmt.Errorf("video: storage port not wired")
	}
	if s.pool == nil {
		// No DB = no registry = no upload: the registry row is the
		// ownership credential (F-AUTH-01), so an upload that cannot
		// register must not store either.
		return "", fmt.Errorf("video: asset registration unavailable (no database)")
	}
	// The project must exist and belong to the caller's workspace before any
	// storage/registry write (the FK alone would surface a bad id as a 500).
	var projExists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM video_project WHERE id=$1 AND workspace_id=$2)`,
		projectID, p.WorkspaceID).Scan(&projExists); err != nil {
		return "", err
	}
	if !projExists {
		return "", ErrProjectNotFound
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
	kind := AssetKindImage
	if strings.HasPrefix(contentType, "audio/") {
		kind = AssetKindAudio
	}
	// Registry row (ON CONFLICT no-op = content-addressed idempotency: the
	// same bytes re-uploaded keep the first registration). Failure here
	// aborts the upload — an object served without its ownership credential
	// is exactly the F-AUTH-01 hole this table closes.
	if rerr := s.registerAsset(ctx, nil, p.WorkspaceID, projectID, obj.Key, kind,
		obj.Size, sha, contentType); rerr != nil {
		return "", fmt.Errorf("video: asset registration failed: %w", rerr)
	}
	if s.ports.Audit != nil {
		s.ports.Audit.Record(ctx, &p.WorkspaceID, p.UserID, AuditAssetUploaded, "video_asset", obj.Key,
			map[string]any{"size": obj.Size, "origin": originOf(ctx)})
	}
	return obj.Key, nil
}

// magicMatches reports whether data's file header carries the magic bytes of
// the declared content type (e2e agent2 P2-5). Unknown-to-the-whitelist
// types never reach here (the caller's whitelist switch runs first). An
// empty/too-short body matches nothing — a 5-byte "hello" cannot pass as a
// PNG.
func magicMatches(contentType string, data []byte) bool {
	switch contentType {
	case "image/png":
		// \x89PNG\r\n\x1a\n — the 4-byte \x89PNG prefix pins the family.
		return len(data) >= 4 && data[0] == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G'
	case "image/jpeg":
		// SOI + first marker byte: every JPEG starts \xFF\xD8\xFF.
		return len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF
	case "image/gif":
		// GIF87a / GIF89a signature.
		return len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a")
	case "image/webp":
		// RIFF container, WEBP fourcc at offset 8.
		return len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP"
	case "audio/mpeg":
		// ID3v2 tag, or a bare MPEG audio frame sync (0xFF Ex: 11-bit sync).
		return (len(data) >= 3 && string(data[:3]) == "ID3") ||
			(len(data) >= 2 && data[0] == 0xFF && data[1]&0xE0 == 0xE0)
	case "audio/mp4":
		// ISO-BMFT: size box then 'ftyp' at offset 4 (m4a/mp4 containers).
		return len(data) >= 12 && string(data[4:8]) == "ftyp"
	case "audio/wav", "audio/x-wav":
		// RIFF container, WAVE form identifier at offset 8.
		return len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE"
	}
	return false
}

// registerAsset inserts one video_asset row (migration 1011). tx nil = own
// statement (pool Exec); non-nil = join the caller's transaction (TTS voice
// registration rides SetScript's locked phase).
func (s *ProjectService) registerAsset(ctx context.Context, tx pgx.Tx, wsID, projectID, key, kind string, size int64, sha, contentType string) error {
	const q = `INSERT INTO video_asset
		(id, workspace_id, project_id, key, kind, bytes, sha256, content_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (key) DO NOTHING`
	if tx != nil {
		_, err := tx.Exec(ctx, q, ids.NewV7().String(), wsID, projectID, key, kind, size, sha, contentType)
		return err
	}
	_, err := s.pool.Exec(ctx, q, ids.NewV7().String(), wsID, projectID, key, kind, size, sha, contentType)
	return err
}

// ListAssets lists a project's registered assets (migration 1011 reference
// list), newest first.
func (s *ProjectService) ListAssets(ctx context.Context, p *webx.Principal, projectID string) ([]Asset, error) {
	if !uuidShape(projectID) {
		return nil, ErrProjectNotFound
	}
	ok, aerr := s.canAccess(ctx, p.WorkspaceID, p.UserID, p.IsPlatformAdmin)
	if aerr != nil {
		return nil, aerr
	}
	if !ok {
		return nil, ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, workspace_id, project_id, key, kind, bytes, sha256, content_type, created_at
		FROM video_asset WHERE project_id=$1 AND workspace_id=$2
		ORDER BY created_at DESC LIMIT 200`, projectID, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Workspace, &a.ProjectID, &a.Key, &a.Kind, &a.Bytes,
			&a.SHA256, &a.ContentType, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CanAccessKey decides whether the principal may serve one storagex key
// through /api/video/files (F-AUTH-01/F-TRA-01). Layered authorization:
// (1) the video/<wsID>/ prefix parse stays the fail-fast first gate (the
// handler checks it before membership); (2) workspace membership is the
// handler's second gate (CanAccess); (3) THIS check is the third gate — the
// key must trace to a registered credential: a video_asset row (uploads and
// TTS voice scratch), or a video_render row (outputs and thumbnails share
// the render id namespace — the render row is the render product's
// ownership credential, per §11.4 "render output + project"). Rows die with
// their project via CASCADE, so "workspace member" no longer implies "read
// every object in the workspace prefix".
func (s *ProjectService) CanAccessKey(ctx context.Context, p *webx.Principal, key string) (bool, error) {
	// Fail closed without a pool: no registry, no credential, no access.
	// (Also keeps the nil-pool handler unit tests meaningful — they assert
	// the 404 on an unregistered key.)
	if s.pool == nil {
		return false, nil
	}
	// Render outputs / thumbnails: video/<ws>/renders/<renderID>/<file>.
	if rest, ok := strings.CutPrefix(key, "video/"); ok {
		wsSeg, tail, _ := strings.Cut(rest, "/")
		if wsSeg == p.WorkspaceID && strings.HasPrefix(tail, "renders/") {
			renderID, _, _ := strings.Cut(strings.TrimPrefix(tail, "renders/"), "/")
			if renderID != "" {
				var n int
				if err := s.pool.QueryRow(ctx,
					`SELECT count(*) FROM video_render WHERE id=$1 AND workspace_id=$2`,
					renderID, p.WorkspaceID).Scan(&n); err != nil {
					return false, err
				}
				return n > 0, nil
			}
		}
	}
	// Assets (uploads + TTS voice scratch): registered video_asset rows.
	var n int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM video_asset WHERE key=$1 AND workspace_id=$2`,
		key, p.WorkspaceID).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}
