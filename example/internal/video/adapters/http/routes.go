// Package videohttp mounts the video studio's REST surface (§4.7):
// project CRUD, IR replacement, preview projection, render submission and
// status, multipart asset upload, and the Range-capable file handler.
// Authorization model: the global Authenticate middleware has run (principal
// present — webx.P asserts); every handler re-checks workspace membership
// through the service (platform-admin exemption lives in the service).
package videohttp

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/haozing/ploykit/authz"
	"github.com/haozing/ploykit/platform/storagex"
	"github.com/haozing/ploykit/platform/webx"

	videoapp "myproduct/internal/video/app"
)

// dispositionFor mirrors storagex's safety default: scriptable types
// (svg/html) download as attachments, everything else inlines.
func dispositionFor(contentType string) string {
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "svg") || strings.Contains(ct, "html") {
		return "attachment"
	}
	return "inline"
}

// Deps wires the HTTP surface. FileServer abstracts the two storage backends
// (§4.7 hard constraints): Local serves bytes with http.ServeContent (Range/
// If-Range/HEAD — mp4 scrubbing needs it); S3 presigns a 302.
type Deps struct {
	Svc *videoapp.ProjectService

	// Authz is the workspace authorizer (authz.New product wiring). Mount
	// panics without it — running the video surface without role checks is a
	// wiring bug (delivery-audit-video-studio §3 N2: the registered
	// video:read/write/render keys must gate the routes, not decorate them).
	Authz *authz.Authorizer

	// FileServer, when wired, takes over GET /api/video/files/{key...}
	// (backend-dependent serving: Local inline vs S3 302). Nil = Local mode
	// driven by Deps.Store below.
	FileServer FileServer
	Store      storagex.Store
}

// FileServer serves or redirects one authorized storage object.
type FileServer interface {
	Serve(ctx interface{ Deadline() (time.Time, bool) }, w http.ResponseWriter, r *http.Request, key, contentType string) error
}

// Mount registers the 11 routes (§4.7). CSRF for the write methods is
// enforced by the product's global csrf middleware covering /api/ (main.go
// wiring; nothing to do here).
// Mount registers the 11 contract routes behind the full authorization
// chain: wsMW (fills principal.WorkspaceID from the X-Workspace-Id header —
// without it every non-admin request is a 403 because the session principal
// carries no workspace) → authz.Require (role gate on the video:* keys the
// product registered) → webx.P (principal assertion). Service-level
// membership remains as defense in depth.
func Mount(mux webx.Router, d Deps, wsMW func(http.Handler) http.Handler) {
	if d.Authz == nil {
		panic("videohttp.Mount: Deps.Authz is required (role checks are not optional)")
	}
	if wsMW == nil {
		wsMW = func(next http.Handler) http.Handler { return next }
	}
	read := authz.Require(d.Authz, "video:read")
	write := authz.Require(d.Authz, "video:write")
	renderPerm := authz.Require(d.Authz, "video:render")
	mux.Handle("GET /api/video/projects", wsMW(read(webx.P(d.handleList))))
	mux.Handle("POST /api/video/projects", wsMW(write(webx.P(d.handleCreate))))
	mux.Handle("GET /api/video/projects/{id}", wsMW(read(webx.P(d.handleGet))))
	mux.Handle("PUT /api/video/projects/{id}/ir", wsMW(write(webx.P(d.handlePutIR))))
	mux.Handle("DELETE /api/video/projects/{id}", wsMW(write(webx.P(d.handleDelete))))
	mux.Handle("GET /api/video/projects/{id}/preview.html", wsMW(read(webx.P(d.handlePreview))))
	mux.Handle("POST /api/video/projects/{id}/renders", wsMW(renderPerm(webx.P(d.handleCreateRender))))
	mux.Handle("GET /api/video/projects/{id}/renders", wsMW(read(webx.P(d.handleListRenders))))
	mux.Handle("GET /api/video/renders/{id}", wsMW(read(webx.P(d.handleGetRender))))
	mux.Handle("POST /api/video/assets", wsMW(write(webx.P(d.handleUploadAsset))))
	mux.Handle("GET /api/video/files/{key...}", wsMW(read(webx.P(d.handleFile))))
}

func (d Deps) handleList(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	items, err := d.Svc.List(r.Context(), p)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, items)
}

func (d Deps) handleCreate(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Title string `json:"title"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" || len([]rune(title)) > 200 {
		webx.ErrValidation(w, "title must be 1-200 characters after trim")
		return
	}
	pr, err := d.Svc.Create(r.Context(), p, title)
	if err != nil {
		webx.WriteErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, pr)
}

func (d Deps) handleGet(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	pr, err := d.Svc.Get(r.Context(), p, r.PathValue("id"))
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{
		"project": pr, "ir": pr.IR, "version": pr.Version,
	})
}

// handlePutIR replaces the whole IR; expected_version is mandatory (optimistic
// lock — a blind overwrite would clobber concurrent agent edits).
func (d Deps) handlePutIR(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		IR              videoapp.IR `json:"ir"`
		ExpectedVersion *int        `json:"expected_version"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	if req.ExpectedVersion == nil {
		webx.ErrValidation(w, "expected_version is required for IR replacement")
		return
	}
	// Mutate runs Validate + anchor re-resolution on top; run fn = wholesale
	// replacement after Meta normalization defaults (fps 0 → 30).
	newVersion, resolutions, err := d.Svc.Mutate(r.Context(), p, r.PathValue("id"), req.ExpectedVersion, func(cur *videoapp.IR) error {
		next := req.IR
		*cur = next
		return nil
	})
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, map[string]any{"version": newVersion, "resolutions": resolutions})
}

func (d Deps) handleDelete(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	if err := d.Svc.Delete(r.Context(), p, r.PathValue("id")); err != nil {
		writeSvcErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handlePreview projects the self-contained player document (§4.4.4):
// text/html; no-store; hash-based CSP; frame-ancestors 'self'.
func (d Deps) handlePreview(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	pr, err := d.Svc.Get(r.Context(), p, r.PathValue("id"))
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	html, err := d.Svc.ProjectHTML(r.Context(), pr.IR)
	if err != nil {
		webx.ErrInternal(w)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	hash, herr := videoapp.InlineScriptHash()
	if herr != nil {
		// A preview without the CSP is not servable: the whole document is
		// inline scripts, so serving it hash-less would be a policy failure,
		// not a degradation (audit P10: silent skip -> explicit error).
		webx.WriteErr(w, videoapp.ErrInternalPreview)
		return
	}
	// font-src data: — the projector inlines the Noto Sans SC subset as a
	// data URI @font-face (F-FNT-01); default-src 'none' would block it.
	h.Set("Content-Security-Policy", "default-src 'none'; script-src "+hash+
		"; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; media-src 'self';"+
		" frame-ancestors 'self'; base-uri 'none'; form-action 'none'")
	h.Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(html)
}

func (d Deps) handleCreateRender(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	var req struct {
		Params          videoapp.RenderParams `json:"params"`
		ExpectedVersion *int                  `json:"expected_version"`
	}
	if !webx.DecodeJSON(w, r, &req) {
		return
	}
	// Idempotency-Key (audit Â§4 P7): a network retry with the same key
	// returns the first submission's render instead of charging twice. Trim
	// + cap length; empty = legacy fire-and-forget submission.
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(key) > 128 {
		key = key[:128]
	}
	render, err := d.Svc.SubmitRender(r.Context(), p, r.PathValue("id"), req.Params, req.ExpectedVersion, key)
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, render)
}

func (d Deps) handleListRenders(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	items, err := d.Svc.ListRenders(r.Context(), p, r.PathValue("id"))
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, items)
}

func (d Deps) handleGetRender(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	render, err := d.Svc.GetRender(r.Context(), p, r.PathValue("id"))
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusOK, render)
}

// handleUploadAsset parses one multipart part (storagex.ParseUpload; the
// /api body limit is the product's global 1MiB gate — no layering here,
// five-pitfalls #2) and persists content-addressed.
func (d Deps) handleUploadAsset(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	up, err := storagex.ParseUpload(r, videoapp.UploadLimit)
	if err != nil {
		if errors.Is(err, storagex.ErrUploadTooLarge) {
			webx.WriteErr(w, videoapp.ErrAssetTooLarge)
			return
		}
		webx.ErrValidation(w, "multipart file field required")
		return
	}
	projectID := r.FormValue("project_id")
	if projectID == "" {
		webx.ErrValidation(w, "project_id form field required")
		return
	}
	key, err := d.Svc.UploadAsset(r.Context(), p, projectID, up.Filename, up.ContentType, up.Data)
	if err != nil {
		writeSvcErr(w, err)
		return
	}
	webx.WriteJSON(w, http.StatusCreated, map[string]any{
		"key": key, "url": "/api/video/files/" + key, "size": len(up.Data),
	})
}

// handleFile serves one storage object with THREE-layer authorization
// (§D8 + F-AUTH-01/F-TRA-01): (1) the key must carry the video/<wsID>/
// prefix (fail-fast — a foreign key is a 404 before any DB work); (2)
// workspace membership on the prefix-derived wsID, checked BEFORE any byte
// is served; (3) the key must trace to a registered ownership credential
// (video_asset row / video_render row) via Svc.CanAccessKey — workspace
// membership alone no longer grants read on every object under the prefix
// ("member ≠ all-readable"), and project deletion revokes access with the
// CASCADEd rows. Local backend streams via http.ServeContent (Range/HEAD/
// If-Range — mp4 scrubbing); S3 presigns a 302 through Deps.FileServer.
func (d Deps) handleFile(w http.ResponseWriter, r *http.Request, p *webx.Principal) {
	key := r.PathValue("key")
	wsID, ok := workspaceFromKey(key)
	if !ok {
		webx.ErrNotFound(w, "object not found")
		return
	}
	ok, err := d.Svc.CanAccess(r.Context(), p, wsID)
	if err != nil || !ok {
		webx.ErrForbidden(w, "not a member of this workspace")
		return
	}
	// Registry gate (F-AUTH-01): membership is necessary but not sufficient.
	// An unregistered (or CASCADE-deleted) key is indistinguishable from a
	// nonexistent one: generic 404, no existence leak.
	ok, aerr := d.Svc.CanAccessKey(r.Context(), p, key)
	if aerr != nil {
		webx.ErrInternal(w)
		return
	}
	if !ok {
		webx.ErrNotFound(w, "object not found")
		return
	}
	if d.FileServer != nil {
		// backend decides: S3 → 302 presign; Local → inline serving.
		if err := d.FileServer.Serve(r.Context(), w, r, key, contentTypeFor(key)); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				webx.ErrNotFound(w, "object not found")
				return
			}
			webx.ErrInternal(w)
		}
		return
	}
	// Local path: open + ServeContent (Range etc.). Content is PRIVATE and
	// revocable (project delete CASCADEs the registry row that authorizes
	// it), so the cache window is short (round4 Q1: the year-long immutable
	// window outlived the revocation — max-age=300 keeps mp4 scrubbing snappy
	// while letting an authorization change stick within minutes).
	body, obj, err := d.Store.Open(r.Context(), key)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			webx.ErrNotFound(w, "object not found")
			return
		}
		webx.ErrInternal(w)
		return
	}
	defer body.Close()
	ct := obj.ContentType
	if ct == "" {
		ct = contentTypeFor(key)
	}
	if ct == "" {
		ct = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", ct)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=300")
	h.Set("Last-Modified", time.Unix(obj.Size, 0).UTC().Format(http.TimeFormat)) // obj has no mtime; now is fine for content-addressed keys
	if dispositionFor(ct) == "attachment" {
		h.Set("Content-Disposition", "attachment")
	}
	if rs, ok := body.(io.ReadSeeker); ok {
		http.ServeContent(w, r, "", time.Time{}, rs)
		return
	}
	// non-seekable store: no Range, plain stream
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}

// workspaceFromKey extracts the workspace segment from video/<wsID>/...
func workspaceFromKey(key string) (string, bool) {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) < 3 || parts[0] != "video" || parts[1] == "" {
		return "", false
	}
	return parts[1], true
}

func contentTypeFor(key string) string {
	if i := strings.LastIndexByte(key, '.'); i >= 0 {
		return mime.TypeByExtension(key[i:])
	}
	return ""
}

// writeSvcErr maps domain errors to HTTP responses (WriteErr handles
// *webx.Error; anything else is a 500).
func writeSvcErr(w http.ResponseWriter, err error) {
	webx.WriteErr(w, err)
}
