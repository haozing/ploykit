package videoapp

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/haozing/ploykit/platform/storagex"
)

// Synthesizer produces voice audio plus word-level timestamps (§4.10.1).
// A nil implementation in Ports means the degrade path (estimated words).
type Synthesizer interface {
	Synthesize(ctx context.Context, text, voice string, speed float64) (VoiceResult, error)
}

// VoiceResult is one successful synthesis. Words may be nil — a vendor that
// returns audio only leaves timing to the Aligner or the estimator. AudioKey
// is a storagex key; when the vendor returns inline bytes instead
// (AudioData), the service persists them via Ports.Store and fills the key.
type VoiceResult struct {
	AudioKey    string   `json:"audio_key"`
	DurationSec float64  `json:"duration_sec"`
	Words       []Word   `json:"words"`
	AudioData   []byte   `json:"-"`
}

// Aligner forces timestamps onto an already-uploaded audio track (WhisperX
// sidecar). Only the "existing audio" flow consumes it.
type Aligner interface {
	Align(ctx context.Context, audioKey, script string) ([]Word, error)
}

// RenderQueue is the dedicated river queue for video renders (§4.9.2:
// isolated from the events and schedule queues).
const RenderQueue = "video"

// RenderKind is the river job kind for RenderArgs.
const RenderKind = "video_render"

// RenderArgs is the river job payload for one render. Declared in app (not
// render) so the service can enqueue it and the worker can consume it without
// an import cycle. It implements river.JobArgs directly (Kind()) — embedding
// river.JobArgs leaves Kind empty, which panics inside river.AddWorker.
type RenderArgs struct {
	RenderID string `json:"render_id"`
}

func (RenderArgs) Kind() string { return RenderKind }

// Enqueuer submits river jobs inside the caller's transaction (adapter wraps
// river.InsertTx with the video queue defaults).
type Enqueuer interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args any, opts *river.InsertOpts) error
}

// Publisher pushes WS frames after commit (adapter wraps wsx broadcast on the
// "video" scope).
type Publisher interface {
	BroadcastEvent(ctx context.Context, event string, payload []byte, eventID string) error
}

// Auditor records audit entries; implementations prefer RecordTx so business
// write and audit live or die together (adapter wraps audit.Recorder).
type Auditor interface {
	RecordTx(ctx context.Context, tx pgx.Tx, workspaceID *string, userID string, action, resourceType, resourceID string, meta map[string]any) error
	Record(ctx context.Context, workspaceID *string, userID string, action, resourceType, resourceID string, meta map[string]any)
}

// QuotaPort is the quota consumption surface: ConsumeWith (idempotency-keyed)
// for render submission, Release for failure compensation (adapter wraps
// quota.Service).
type QuotaPort interface {
	// ConsumeWithTx charges one unit inside the CALLER's transaction with a
	// client idempotency key (audit §4 P2/P7): the charge commits atomically
	// with the render row + river job. ErrIdemReplay = duplicate submission.
	ConsumeWithTx(ctx context.Context, tx pgx.Tx, workspaceID, key string, n int64, now time.Time, idemKey string) error
	// ReleaseTx releases one unit on the EXPLICIT consumption period inside
	// the caller's transaction (audit §4 P3): month-boundary safe, and the
	// release lands atomically with the terminal state write.
	ReleaseTx(ctx context.Context, tx pgx.Tx, workspaceID, key string, n int64, period string) error
	// Release is the non-transactional fallback (pure-port mode / sweep).
	Release(ctx context.Context, workspaceID, key string, n int64, now time.Time) error
}

// Membership answers "may this user act in this workspace". Platform-admin
// exemption is wiring policy (MembershipImpl), not domain logic; the domain
// only calls the interface and checks Principal.IsPlatformAdmin itself.
type Membership interface {
	IsMember(ctx context.Context, workspaceID, userID string) (bool, error)
}

// CapProbe reports whether the render capability is configured (adapter
// wraps capx.Available(); kept behind an interface so nothing here imports
// capx). False = E_NOT_CONFIGURED before any render row or quota spend.
type CapProbe interface {
	CapAvailable() bool
}

// Ports is the full injection surface of the domain (§4.3, plus Store for
// asset persistence and Cap for the render gate — both documented
// deviations).
type Ports struct {
	Synth      Synthesizer // nil = degrade to estimated words
	Aligner    Aligner     // nil = degrade
	Enqueue    Enqueuer    // river InsertTx
	Publish    Publisher   // wsx broadcast
	Audit      Auditor     // audit recorder
	Quota      QuotaPort   // consume/release
	Membership Membership  // (ws, user) → bool
	Store      storagex.Store
	Cap        CapProbe
}
