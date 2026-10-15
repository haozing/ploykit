// Package storagex HTTP companions (storage-walk #14): the serving handler
// for the /uploads/ URL convention LocalBackend.URL() produces, and the
// multipart parsing helper for upload endpoints. Both are opt-in building
// blocks — authentication and upload policy (who may store what, size/type
// ceilings per route) remain product decisions and live in the product's own
// handler wrapping these.
package storagex

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// ServeUploads serves previously stored objects under the URL space the
// backend's URL() produces ("/uploads/{key}" for Local). GET/HEAD only;
// Content-Type from the stored metadata; immutable caching (objects are
// content-addressed by key convention — products that overwrite keys in
// place should lower the max-age); Content-Disposition inherits the
// safe-default (inline for non-scriptable types, attachment otherwise) the
// store already decided at Put time. Range requests are not implemented —
// media streaming products should front this with their own handler.
func ServeUploads(store Store) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		key := strings.TrimPrefix(r.URL.Path, "/uploads/")
		if !ValidKey(key) {
			http.NotFound(w, r)
			return
		}
		body, obj, err := store.Open(r.Context(), key)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				http.NotFound(w, r)
				return
			}
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		defer body.Close()

		ct := obj.ContentType
		if ct == "" {
			ct = mime.TypeByExtension(path.Ext(key))
		}
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if disp := dispositionFor(ct); disp == "attachment" {
			w.Header().Set("Content-Disposition", "attachment")
		}
		w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		_, _ = io.Copy(w, body)
	})
}

// Uploaded is one parsed multipart file part.
type Uploaded struct {
	Filename    string
	ContentType string
	Data        []byte
}

// ErrUploadTooLarge wraps the MaxBytesReader breach so products can map it
// to 413 without string matching.
var ErrUploadTooLarge = errors.New("storagex: upload exceeds the configured limit")

// ParseUpload reads exactly one file part from a multipart request body
// ("file" by field name; use ParseUploadField for another name). The request
// body MUST already be wrapped by http.MaxBytesReader at or above maxBytes —
// this helper enforces its own cap on the buffered part and reports
// ErrUploadTooLarge on breach. Use it for the common "one file per request"
// product endpoint; multi-file endpoints should iterate r.MultipartForm()
// themselves with the same size discipline.
func ParseUpload(r *http.Request, maxBytes int64) (Uploaded, error) {
	return ParseUploadField(r, maxBytes, "file")
}

// ParseUploadField is ParseUpload with an explicit form field name.
func ParseUploadField(r *http.Request, maxBytes int64, field string) (Uploaded, error) {
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		return Uploaded{}, ErrUploadTooLarge
	}
	file, hdr, err := r.FormFile(field)
	if err != nil {
		return Uploaded{}, err
	}
	defer file.Close()
	if hdr.Size > maxBytes {
		return Uploaded{}, ErrUploadTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return Uploaded{}, err
	}
	if int64(len(data)) > maxBytes {
		return Uploaded{}, ErrUploadTooLarge
	}
	ct := hdr.Header.Get("Content-Type")
	if ct == "" {
		ct = mime.TypeByExtension(path.Ext(hdr.Filename))
	}
	return Uploaded{Filename: hdr.Filename, ContentType: ct, Data: data}, nil
}
