package videoapp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/migrations"
	"github.com/haozing/ploykit/platform/ids"
	"github.com/haozing/ploykit/platform/pgmigrate"
	"github.com/haozing/ploykit/platform/storagex"
	"github.com/haozing/ploykit/platform/webx"
)

// DB-gated integration suite (TEST_DATABASE_URL; skipped otherwise) — the
// service's real SQL: Create/Get/Mutate optimistic lock, anchor write-back,
// SubmitRender ordering, render listing. Bootstrap = framework migration
// chain + product migrations (task/handlers_test.go pattern).

var prodMigrationRe = regexp.MustCompile(`^(\d{3,})_[a-z0-9_]+\.up\.sql$`)

func applyProductMigrations(ctx context.Context, t *testing.T, pool *pgxpool.Pool) error {
	t.Helper()
	const dir = "../../../cmd/app/migrations"
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read %s: %w", dir, err)
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && prodMigrationRe.MatchString(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		version := prodMigrationRe.FindStringSubmatch(name)[1]
		var applied bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		script := fmt.Sprintf("BEGIN;\n%s\nINSERT INTO schema_migrations(version) VALUES ('%s');\nCOMMIT;", string(body), version)
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return err
		}
		_, execErr := conn.Conn().PgConn().Exec(ctx, script).ReadAll()
		conn.Release()
		if execErr != nil {
			return fmt.Errorf("apply %s: %w", name, execErr)
		}
	}
	return nil
}

type videoEnv struct {
	pool        *pgxpool.Pool
	svc         *ProjectService
	userID      string
	wsID        string
	wsForeign   string
	publish     *capturedPublisher
	cleanupFns  []func()
}

type capturedPublisher struct{ events []string }

func (c *capturedPublisher) BroadcastEvent(_ context.Context, event string, _ []byte, _ string) error {
	c.events = append(c.events, event)
	return nil
}

func newVideoEnv(t *testing.T) *videoEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	require.NoError(t, pgmigrate.Up(ctx, pool, migrations.FS, "."), "framework migration chain")
	require.NoError(t, applyProductMigrations(ctx, t, pool), "product migration chain 1001+")

	uniq := time.Now().UnixNano()
	var uid string
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO "user" (email, display_name) VALUES ($1, 'video test') RETURNING id`,
		fmt.Sprintf("video-%d@test.local", uniq)).Scan(&uid))
	mkWs := func(name string) string {
		var id string
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO workspace (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
			fmt.Sprintf("video-%d-%s", uniq, name), name, uid).Scan(&id))
		return id
	}
	wsID := mkWs("main")
	wsForeign := mkWs("foreign")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM workspace WHERE id IN ($1, $2)`, wsID, wsForeign)
		_, _ = pool.Exec(ctx, `DELETE FROM "user" WHERE id = $1`, uid)
	})

	pub := &capturedPublisher{}
	svc := NewProjectService(pool, Ports{
		Membership: memberOf{wsID: wsID, userID: uid},
		Publish:    pub,
		Audit:      noopAudit{},
	}, nil)
	return &videoEnv{pool: pool, svc: svc, userID: uid, wsID: wsID, wsForeign: wsForeign, publish: pub}
}

// memberOf grants membership only for its own workspace (the workspace rows
// above are created by the test user, so workspace membership = created-by
// check would also pass; the fake keeps the test deterministic).
type memberOf struct{ wsID, userID string }

func (m memberOf) IsMember(_ context.Context, wsID, _ string) (bool, error) {
	return wsID == m.wsID, nil
}

type noopAudit struct{}

func (noopAudit) RecordTx(_ context.Context, _ pgx.Tx, _ *string, _ string, _, _, _ string, _ map[string]any) error {
	return nil
}

func (noopAudit) Record(_ context.Context, _ *string, _ string, _, _, _ string, _ map[string]any) {}

func (e *videoEnv) principal(ws string) *webx.Principal {
	return &webx.Principal{UserID: e.userID, WorkspaceID: ws, Source: webx.SourceSession}
}

func TestIntegration_CreateMutateGet(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()

	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "演示项目")
	require.NoError(t, err)
	assert.Equal(t, 1, pr.Version)
	assert.Equal(t, "演示项目", pr.Title)

	// Mutate: SetScript writes words + resolves anchors + bumps version.
	v2, resolutions, source, err := e.svc.SetScript(ctx, e.principal(e.wsID), pr.ID,
		"这款产品发布后 留存率提升了三倍", nil)
	require.NoError(t, err)
	assert.Equal(t, 2, v2)
	assert.Equal(t, WordSourceEstimated, source, "no TTS wired → estimated")
	require.Len(t, resolutions, 0, "no effects yet")

	// Add an effect anchored at a word, then re-set the script: anchor
	// re-resolution writes resolvedFrom back (drift visible).
	_, rf, err := e.svc.AddEffectAtWord(ctx, e.principal(e.wsID), pr.ID,
		Anchor{Text: "三倍", Occurrence: 0}, EffectPulse, []byte(`{"scale":1.3}`), "", nil)
	require.NoError(t, err)
	require.NotNil(t, rf)
	assert.Equal(t, AnchorExact, rf.Reason)

	got, err := e.svc.Get(ctx, e.principal(e.wsID), pr.ID)
	require.NoError(t, err)
	require.Len(t, got.IR.Effects, 1)
	require.NotNil(t, got.IR.Effects[0].ResolvedFrom)
	assert.Equal(t, AnchorExact, got.IR.Effects[0].ResolvedFrom.Reason)

	// WS push fired after commit
	assert.Contains(t, e.publish.events, EventIRUpdated)

	// Cross-workspace Get is a 404 (workspace predicate), not a leak.
	_, err = e.svc.Get(ctx, e.principal(e.wsForeign), pr.ID)
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)
}

func TestIntegration_OptimisticLockConflict(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "锁测试")
	require.NoError(t, err)

	stale := pr.Version - 1
	if stale < 1 {
		stale = 1
	}
	// expectedVersion = stale (pr.Version is 1; simulate another writer first)
	if pr.Version > 1 {
		_, _, _, err = e.svc.SetScript(ctx, e.principal(e.wsID), pr.ID, "第一次改稿", nil)
		require.NoError(t, err)
	}
	wrong := pr.Version + 5
	var we *webx.Error
	_, _, _, err = e.svc.SetScript(ctx, e.principal(e.wsID), pr.ID, "冲突稿", &wrong)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_VERSION_CONFLICT", we.Code)
	_ = stale
}

func TestIntegration_SubmitRender_GateOrder(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "渲染测试")
	require.NoError(t, err)

	// Cap unwired → E_NOT_CONFIGURED before quota/render-row side effects.
	var we *webx.Error
	_, err = e.svc.SubmitRender(ctx, e.principal(e.wsID), pr.ID, RenderParams{}, nil, "")
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_NOT_CONFIGURED", we.Code)
	assert.Equal(t, httpStatusUnavailable, we.Status)

	// renders list stays empty (no row was created)
	items, err := e.svc.ListRenders(ctx, e.principal(e.wsID), pr.ID)
	require.NoError(t, err)
	assert.Empty(t, items)
}

// TestIntegration_SubmitRender_ParamsRanges anchors e2e agent3 Bug-3: the
// render-parameter range gate must fail closed (400) instead of silently
// persisting bgm_volume=1.5 / fps=23, while fps=0 keeps the documented
// inherit-from-meta normalization end to end.
func TestIntegration_SubmitRender_ParamsRanges(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	p := e.principal(e.wsID)
	e.svc.ports.Cap = fakeCap{available: true}
	pr, err := e.svc.Create(ctx, p, "参数范围")
	require.NoError(t, err)

	var we *webx.Error
	// bgm_volume out of [0,1] → 400, no row, no quota spend.
	_, err = e.svc.SubmitRender(ctx, p, pr.ID, RenderParams{FPS: 30, BGMVolume: 1.5}, nil, "")
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_RENDER_PARAMS_INVALID", we.Code)
	assert.Equal(t, 400, we.Status)
	assert.Contains(t, we.Message, "bgm_volume")

	// fps=23 not in the whitelist → rejected, not coerced.
	_, err = e.svc.SubmitRender(ctx, p, pr.ID, RenderParams{FPS: 23}, nil, "")
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_RENDER_PARAMS_INVALID", we.Code)
	assert.Contains(t, we.Message, "fps")

	// fps=0 → inherit the project meta fps (Create's default is 30) and
	// normalize lands in the persisted params.
	r, err := e.svc.SubmitRender(ctx, p, pr.ID, RenderParams{}, nil, "")
	require.NoError(t, err)
	assert.Equal(t, 30, r.Params.FPS, "fps=0 normalized to the IR meta fps")
	assert.Equal(t, DurationFrames(pr.IR, 30), r.FramesTotal)

	// Negative bgm_volume is equally out of range.
	_, err = e.svc.SubmitRender(ctx, p, pr.ID, RenderParams{FPS: 30, BGMVolume: -0.1}, nil, "")
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Contains(t, we.Message, "bgm_volume")
}

// TestIntegration_UploadAsset_LimitChannels anchors e2e agent2 P2-3: the
// REST multipart channel accepts ~2MB images under UploadLimitLarge (the
// size the documented escape hatch promised), while the MCP base64 channel
// keeps its ~700KB cap on the same body.
func TestIntegration_UploadAsset_LimitChannels(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	e.svc.ports.Store = newFakeStore()
	p := e.principal(e.wsID)
	pr, err := e.svc.Create(ctx, p, "大资产")
	require.NoError(t, err)

	// ~2MB PNG (real header, agent2's probe size) passes the REST cap.
	big := append(append([]byte{}, pngBytes...), bytes.Repeat([]byte{0}, 2<<20)...)
	_, err = e.svc.UploadAsset(ctx, p, pr.ID, "big.png", "image/png", big, UploadLimitLarge)
	require.NoError(t, err, "REST channel cap is 50MB — a 2MB upload must pass")

	// The same body through the MCP base64 channel cap is rejected.
	var we *webx.Error
	_, err = e.svc.UploadAsset(ctx, p, pr.ID, "big.png", "image/png", big, UploadLimit)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_ASSET_TOO_LARGE", we.Code)
}

// TestIntegration_UploadAsset_MagicMismatch anchors e2e agent2 P2-5 against
// the real registry/store path: a non-PNG body declared image/png is
// rejected and registers nothing.
func TestIntegration_UploadAsset_MagicMismatch(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	store := newFakeStore()
	e.svc.ports.Store = store
	p := e.principal(e.wsID)
	pr, err := e.svc.Create(ctx, p, "魔数")
	require.NoError(t, err)

	var we *webx.Error
	_, err = e.svc.UploadAsset(ctx, p, pr.ID, "hello.png", "image/png", []byte("hello"), UploadLimit)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_ASSET_UNSUPPORTED", we.Code)
	assert.Contains(t, we.Message, "does not match", "mismatch message distinguishes the cause")
	assert.Empty(t, store.puts, "nothing stored for a rejected upload")

	assets, err := e.svc.ListAssets(ctx, p, pr.ID)
	require.NoError(t, err)
	assert.Empty(t, assets, "no registry row for a rejected upload")
}

// fakeStore is the minimal storagex.Store double for the asset registry
// suite (puts land in memory; DeleteMulti records keys and can fail on
// demand). Mirrors the render package's memStore pattern.
type fakeStore struct {
	puts    map[string][]byte
	deleted []string
	failDel bool
}

// pngBytes / mp3Bytes carry REAL file headers: the upload magic-byte gate
// (e2e agent2 P2-5) rejects declared-type-mismatched bodies, so asset
// fixtures must be genuine PNG/MP3-shaped bytes.
var pngBytes = append([]byte{0x89, 'P', 'N', 'G'}, "\r\n\x1a\nfixture"...)
var mp3Bytes = append([]byte("ID3"), "fixture"...)

func newFakeStore() *fakeStore { return &fakeStore{puts: map[string][]byte{}} }

func (f *fakeStore) Put(_ context.Context, key, _ string, r io.Reader) (storagex.Object, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return storagex.Object{}, err
	}
	f.puts[key] = b
	return storagex.Object{Key: key, Size: int64(len(b))}, nil
}

func (f *fakeStore) Open(_ context.Context, key string) (io.ReadCloser, storagex.Object, error) {
	if b, ok := f.puts[key]; ok {
		return io.NopCloser(bytes.NewReader(b)), storagex.Object{Key: key, Size: int64(len(b))}, nil
	}
	return nil, storagex.Object{}, fs.ErrNotExist
}

func (f *fakeStore) List(_ context.Context, prefix string) ([]storagex.Object, error) {
	return nil, nil
}

func (f *fakeStore) Delete(_ context.Context, key string) error {
	if f.failDel {
		return errors.New("storage down")
	}
	delete(f.puts, key)
	f.deleted = append(f.deleted, key)
	return nil
}

func (f *fakeStore) DeleteMulti(ctx context.Context, keys ...string) error {
	for _, k := range keys {
		if err := f.Delete(ctx, k); err != nil {
			return err
		}
	}
	return nil
}

func (f *fakeStore) URL(key string) string { return "/uploads/" + key }
func (f *fakeStore) Presign(_ context.Context, key string, _ time.Duration) (string, error) {
	return f.URL(key), nil
}

// TestIntegration_AssetRegistry_Lifecycle covers F-AUTH-01/F-TRA-01 end to
// end: upload → registry row → CanAccessKey grants; project delete → rows
// cascade + storage sweep → CanAccessKey revokes (the key prefix parse can
// no longer rescue it: the key itself is gone from every credential table).
func TestIntegration_AssetRegistry_Lifecycle(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	store := newFakeStore()
	e.svc.ports.Store = store // test-only injection; NewProjectService kept for the other ports

	pr, err := e.svc.Create(ctx, e.principal(e.wsID), "资产登记")
	require.NoError(t, err)

	p := e.principal(e.wsID)
	key, err := e.svc.UploadAsset(ctx, p, pr.ID, "banner.png", "image/png", pngBytes, UploadLimit)
	require.NoError(t, err)
	require.Contains(t, key, "/assets/"+pr.ID+"/")
	require.NotEmpty(t, store.puts[key], "object persisted to storage")

	// Registry row exists with the content hash + kind.
	assets, err := e.svc.ListAssets(ctx, p, pr.ID)
	require.NoError(t, err)
	require.Len(t, assets, 1)
	a := assets[0]
	assert.Equal(t, key, a.Key)
	assert.Equal(t, AssetKindImage, a.Kind)
	assert.Equal(t, int64(len(pngBytes)), a.Bytes)
	assert.Equal(t, sha256Hex(pngBytes), a.SHA256)
	assert.Equal(t, "image/png", a.ContentType)

	// Audio content-type maps to kind=audio.
	audioKey, err := e.svc.UploadAsset(ctx, p, pr.ID, "v.mp3", "audio/mpeg", mp3Bytes, UploadLimit)
	require.NoError(t, err)
	assets, err = e.svc.ListAssets(ctx, p, pr.ID)
	require.NoError(t, err)
	require.Len(t, assets, 2)
	byKey := map[string]Asset{assets[0].Key: assets[0], assets[1].Key: assets[1]}
	assert.Equal(t, AssetKindAudio, byKey[audioKey].Kind)

	// Content-addressed idempotency: same bytes → same key, one row.
	dupKey, err := e.svc.UploadAsset(ctx, p, pr.ID, "banner.png", "image/png", pngBytes, UploadLimit)
	require.NoError(t, err)
	assert.Equal(t, key, dupKey)
	assets, _ = e.svc.ListAssets(ctx, p, pr.ID)
	require.Len(t, assets, 2, "ON CONFLICT keeps the first registration")

	// CanAccessKey: member + registered → true (render/asset branches).
	ok, err := e.svc.CanAccessKey(ctx, p, key)
	require.NoError(t, err)
	assert.True(t, ok, "registered asset key grants access")

	// Foreign key with another workspace prefix → denied even for a member.
	ok, err = e.svc.CanAccessKey(ctx, p, "video/"+e.wsForeign+"/assets/other/abc.png")
	require.NoError(t, err)
	assert.False(t, ok, "another workspace's key never matches the caller's workspace predicate")

	// Unregistered key inside the same workspace prefix → 404-equivalent (false).
	ok, err = e.svc.CanAccessKey(ctx, p, e.wsID+"/assets/"+pr.ID+"/unregistered.png")
	require.NoError(t, err)
	assert.False(t, ok, "membership alone does not grant an unregistered key")

	// Bad project id → E_VIDEO_PROJECT_NOT_FOUND (explicit check, not FK 500).
	_, err = e.svc.UploadAsset(ctx, p, "00000000-0000-0000-0000-000000000000", "x.png", "image/png", pngBytes, UploadLimit)
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)

	// Malformed (non-UUID) project id → same 404 semantics, no SQL cast 500
	// (e2e uuid-shape guard).
	_, err = e.svc.UploadAsset(ctx, p, "not-a-uuid", "x.png", "image/png", pngBytes, UploadLimit)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_PROJECT_NOT_FOUND", we.Code)

	// Foreign workspace principal cannot touch this project's assets.
	_, err = e.svc.UploadAsset(ctx, e.principal(e.wsForeign), pr.ID, "x.png", "image/png", pngBytes, UploadLimit)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_FORBIDDEN", we.Code)

	// Project delete: registry rows cascade + storage sweep deletes the objects.
	require.NoError(t, e.svc.Delete(ctx, p, pr.ID))
	assert.ElementsMatch(t, []string{key, audioKey}, store.deleted, "storage sweep collected exactly the registered keys")

	// Revocation: the key prefix still parses, but no registry/render row
	// survives → CanAccessKey false (the file handler maps this to 404).
	ok, err = e.svc.CanAccessKey(ctx, p, key)
	require.NoError(t, err)
	assert.False(t, ok, "CASCADE-deleted asset revokes access")

	// Render products: a succeeded render row grants its output key WITHOUT
	// a video_asset row; deleting the project cascades the render row too.
	// The row id doubles as the key segment (render_pipeline.go builds
	// video/<ws>/renders/<rowID>/output.mp4 from the row), so the fixture
	// inserts the row first and derives the key from the RETURNING id.
	pr2, err := e.svc.Create(ctx, p, "渲染产物归属")
	require.NoError(t, err)
	var renderID string
	require.NoError(t, e.pool.QueryRow(ctx, `
		INSERT INTO video_render (id, project_id, workspace_id, status, ir_snapshot, output_key, created_by)
		VALUES ($1, $2, $3, 'succeeded', '{}'::jsonb, '', 'tester') RETURNING id`,
		ids.NewV7().String(), pr2.ID, e.wsID).Scan(&renderID))
	outKey := "video/" + e.wsID + "/renders/" + renderID + "/output.mp4"
	_, xerr := e.pool.Exec(ctx,
		`UPDATE video_render SET output_key=$2 WHERE id=$1`, renderID, outKey)
	require.NoError(t, xerr)
	ok, err = e.svc.CanAccessKey(ctx, p, outKey)
	require.NoError(t, err)
	assert.True(t, ok, "render output key granted by the render row (no asset row)")
	// render thumbnail shares the render id namespace → same grant.
	thumbKey := strings.TrimSuffix(outKey, "output.mp4") + "thumb.jpg"
	ok, err = e.svc.CanAccessKey(ctx, p, thumbKey)
	require.NoError(t, err)
	assert.True(t, ok, "thumbnail resolves through the same render row")

	// Fake render id under the prefix (forged path) → denied.
	ok, err = e.svc.CanAccessKey(ctx, p, "video/"+e.wsID+"/renders/"+ids.NewV7().String()+"/output.mp4")
	require.NoError(t, err)
	assert.False(t, ok, "forged render id has no row")
}

// TestIntegration_AssetRegistry_DeleteSweepFailOpen covers the storage-sweep
// failure contract: the DB rows are authoritative (delete succeeds), a
// storage outage only orphans the objects (they lose their credential rows,
// so they can no longer be served).
func TestIntegration_AssetRegistry_DeleteSweepFailOpen(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	store := newFakeStore()
	e.svc.ports.Store = store
	store.failDel = true

	p := e.principal(e.wsID)
	pr, err := e.svc.Create(ctx, p, "清扫失败")
	require.NoError(t, err)
	key, err := e.svc.UploadAsset(ctx, p, pr.ID, "a.png", "image/png", pngBytes, UploadLimit)
	require.NoError(t, err)

	// Delete still succeeds (storage failure is warn-only).
	require.NoError(t, e.svc.Delete(ctx, p, pr.ID))
	ok, err := e.svc.CanAccessKey(ctx, p, key)
	require.NoError(t, err)
	assert.False(t, ok, "credential row is gone even when the object survives")
	require.Len(t, store.puts, 1, "object itself survived the failed sweep (soft-delete acceptable)")
}

// imageEl is an image element referencing key (geometry valid per §4.2.2).
func imageEl(id, key string) Element {
	return Element{ID: id, Type: ElementImage, Src: key, X: 0, Y: 0, W: 100, H: 100, Z: 1}
}

// TestIntegration_ValidateAssetRefs covers the §8.5a.2 option-B ruling: a
// dangling image src (no video_asset row AND no storage object) is rejected
// at write time with E_VIDEO_IR_INVALID + details.field=elements[N].src;
// a registered src (round-8+ path) and a physically-present but unregistered
// src (legacy window) both pass. All Mutate callers (PUT IR + every MCP
// mutation tool) flow through this check.
func TestIntegration_ValidateAssetRefs(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	store := newFakeStore()
	e.svc.ports.Store = store

	p := e.principal(e.wsID)
	pr, err := e.svc.Create(ctx, p, "素材引用校验")
	require.NoError(t, err)

	dangling := "video/" + e.wsID + "/assets/" + pr.ID + "/dangling.png"

	// 1. Dangling src via UpsertElement → E_VIDEO_IR_INVALID.
	_, _, err = e.svc.UpsertElement(ctx, p, pr.ID, imageEl("el_bad", dangling), nil)
	require.Error(t, err)
	var we *webx.Error
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_IR_INVALID", we.Code)
	assert.Contains(t, we.Message, "elements[0].src", "field path embedded in the message (details.field surface)")
	assert.Contains(t, we.Message, "asset not registered")

	// 2. Dangling src via wholesale PUT-IR Mutate → same rejection (the
	// REST PUT /ir path), and the row is untouched (fail before UPDATE).
	_, _, err = e.svc.Mutate(ctx, p, pr.ID, nil, func(ir *IR) error {
		ir.Elements = append(ir.Elements, imageEl("el_bad2", dangling))
		return nil
	})
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_IR_INVALID", we.Code)
	got, gerr := e.svc.Get(ctx, p, pr.ID)
	require.NoError(t, gerr)
	assert.Len(t, got.IR.Elements, 0, "rejected write must not persist the element")

	// 3. Registered src passes the write (the round-8+ upload path).
	regKey, err := e.svc.UploadAsset(ctx, p, pr.ID, "banner.png", "image/png", pngBytes, UploadLimit)
	require.NoError(t, err)
	v1, _, err := e.svc.UpsertElement(ctx, p, pr.ID, imageEl("el_ok", regKey), nil)
	require.NoError(t, err, "registered src must pass")
	assert.Equal(t, 2, v1)

	// 4. Legacy window: physically present but unregistered → passes.
	legacyKey := "video/" + e.wsID + "/assets/" + pr.ID + "/legacy.png"
	_, lerr := store.Put(ctx, legacyKey, "image/png", strings.NewReader("legacy-bytes"))
	require.NoError(t, lerr)
	_, _, err = e.svc.UpsertElement(ctx, p, pr.ID, imageEl("el_legacy", legacyKey), nil)
	require.NoError(t, err, "unregistered but present object passes the legacy window")

	// 5. Offending element index surfaces in the field path: after the three
	// appends above (el_ok / el_legacy / el_legacy2) the bad element lands
	// at elements[3].
	_, _, err = e.svc.UpsertElement(ctx, p, pr.ID, imageEl("el_legacy2", legacyKey), nil)
	require.NoError(t, err)
	// append a bad element through wholesale mutation
	_, _, err = e.svc.Mutate(ctx, p, pr.ID, nil, func(ir *IR) error {
		ir.Elements = append(ir.Elements, imageEl("el_bad3", dangling))
		return nil
	})
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Contains(t, we.Message, "elements[3].src", "index of the offending element in the field path")

	// 6. Foreign workspace row cannot satisfy the check (workspace-scoped).
	// The env fake denies wsForeign membership, so seed the row directly.
	var foreignWsID, foreignProjID string
	foreignWsID = e.wsForeign
	require.NoError(t, e.pool.QueryRow(ctx, `
		INSERT INTO video_project (id, workspace_id, title, ir, created_by, updated_by)
		VALUES ($1, $2, '他域项目', '{}'::jsonb, 'tester', 'tester') RETURNING id`,
		ids.NewV7().String(), foreignWsID).Scan(&foreignProjID))
	foreignKey := "video/" + foreignWsID + "/assets/" + foreignProjID + "/f.png"
	_, err = e.pool.Exec(ctx, `
		INSERT INTO video_asset (id, workspace_id, project_id, key, kind, bytes, sha256, content_type)
		VALUES ($1, $2, $3, $4, 'image', 2, 'beef', 'image/png')`,
		ids.NewV7().String(), foreignWsID, foreignProjID, foreignKey)
	require.NoError(t, err)
	_, _, err = e.svc.UpsertElement(ctx, p, pr.ID, imageEl("el_foreign", foreignKey), nil)
	require.Error(t, err, "another workspace's registered key is not a credential here")
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_IR_INVALID", we.Code)

	// 7. Non-image elements and empty src stay exempt (shape rules only).
	_, _, err = e.svc.UpsertElement(ctx, p, pr.ID, Element{ID: "el_text", Type: ElementText, Text: "hi", X: 0, Y: 0, W: 10, H: 10}, nil)
	require.NoError(t, err)
	_, _, err = e.svc.UpsertElement(ctx, p, pr.ID, Element{ID: "el_shape", Type: ElementShape, X: 0, Y: 0, W: 10, H: 10}, nil)
	require.NoError(t, err)

	// 8. Audio keys (G-01c): an unregistered voice/bgm key is rejected at
	// write time with the audio.<track>.key field path — the render-time
	// tempFile failure moves to write time.
	_, err = e.svc.SetAudio(ctx, p, pr.ID, &Audio{
		Voice: &AudioTrack{Key: dangling, Volume: 1},
	}, nil)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Equal(t, "E_VIDEO_IR_INVALID", we.Code)
	assert.Contains(t, we.Message, "audio.voice.key")

	_, err = e.svc.SetAudio(ctx, p, pr.ID, &Audio{
		BGM: &AudioTrack{Key: dangling, Volume: 0.5},
	}, nil)
	require.Error(t, err)
	require.True(t, errorAsWebx(err, &we))
	assert.Contains(t, we.Message, "audio.bgm.key")

	// 9. Registered audio key passes (the upload path registers).
	audioKey, err := e.svc.UploadAsset(ctx, p, pr.ID, "bgm.mp3", "audio/mpeg", mp3Bytes, UploadLimit)
	require.NoError(t, err)
	_, err = e.svc.SetAudio(ctx, p, pr.ID, &Audio{
		Voice: &AudioTrack{Key: audioKey, DurationSec: 2, Volume: 1},
		BGM:   &AudioTrack{Key: audioKey, Volume: 0.3},
	}, nil)
	require.NoError(t, err, "registered audio keys must pass the write-time gate")
}

// TestIntegration_ComposeProject_PreservesAudio anchors the G-01b patch: the
// composer assembles an IR without the Audio field, and the wholesale
// replacement in the Mutate closure must carry the old audio over (set_card
// would otherwise drop the BGM on every copy edit).
func TestIntegration_ComposeProject_PreservesAudio(t *testing.T) {
	e := newVideoEnv(t)
	ctx := context.Background()
	e.svc.ports.Store = newFakeStore()
	p := e.principal(e.wsID)
	pr, err := e.svc.Create(ctx, p, "compose 保音频")
	require.NoError(t, err)

	audioKey, err := e.svc.UploadAsset(ctx, p, pr.ID, "bgm.mp3", "audio/mpeg", mp3Bytes, UploadLimit)
	require.NoError(t, err)
	_, err = e.svc.SetAudio(ctx, p, pr.ID, &Audio{
		BGM: &AudioTrack{Key: audioKey, Volume: 0.4},
	}, nil)
	require.NoError(t, err)

	e.svc.WithScriptComposer(func(script, templateKey, themeKey string, words []Word) (IR, error) {
		// composer 产物（scriptgen.Compose 同形态）不带 Audio 字段。
		return IR{Meta: Meta{FPS: 30, Width: 1080, Height: 1920, DurationSec: 3}, Script: script}, nil
	}, func(script string) ([]CardInfo, error) { return nil, nil })

	_, err = e.svc.ComposeProject(ctx, p, pr.ID, ComposeInput{Script: "第一段\n\n第二段", TemplateKey: "t", ThemeKey: "dark"})
	require.NoError(t, err)

	got, gerr := e.svc.Get(ctx, p, pr.ID)
	require.NoError(t, gerr)
	require.NotNil(t, got.IR.Audio, "compose 后音频轨必须存活")
	require.NotNil(t, got.IR.Audio.BGM)
	assert.Equal(t, audioKey, got.IR.Audio.BGM.Key)
	assert.InDelta(t, 0.4, got.IR.Audio.BGM.Volume, 1e-9)
	assert.Nil(t, got.IR.Audio.Voice, "旧 IR 未挂的轨不凭空出现")
}

const httpStatusUnavailable = 503

func errorAsWebx(err error, target **webx.Error) bool {
	for err != nil {
		if we, ok := err.(*webx.Error); ok {
			*target = we
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
