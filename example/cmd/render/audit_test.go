package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/platform/renderx"
)

func TestAuditSEOFiles(t *testing.T) {
	dir := t.TempDir()
	pages := map[string]string{
		"index.html":        `<html><head><title>首页</title><meta name="description" content="d"><link rel="canonical" href="/"></head><body></body></html>`,
		"blog/no-meta.html": `<html><head><title>只有标题</title></head><body></body></html>`,
		"about.html":        `<html><head><meta charset="utf-8"></head><body></body></html>`,
		"dup.html":          `<html><head><title>双份</title><meta name="description" content="d"><link rel="canonical" href="/a"><link rel="canonical" href="/b"></head><body></body></html>`,
	}
	manifest := renderx.PrerenderManifest{}
	for file, html := range pages {
		full := filepath.Join(dir, filepath.FromSlash(file))
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o755))
		require.NoError(t, os.WriteFile(full, []byte(html), 0o644))
		manifest.Pages = append(manifest.Pages, renderx.PrerenderManifestEntry{Path: "/" + file, File: file})
	}

	rep, err := auditSEOFiles(dir, manifest)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"/about.html"}, rep.missingTitle)
	assert.ElementsMatch(t, []string{"/blog/no-meta.html", "/about.html"}, rep.missingDesc)
	assert.ElementsMatch(t, []string{"/blog/no-meta.html", "/about.html"}, rep.missingCanonical)
	assert.ElementsMatch(t, []string{"/dup.html"}, rep.duplicateCanonical)
}

func TestAuditSEOFilesMissingArtifact(t *testing.T) {
	_, err := auditSEOFiles(t.TempDir(), renderx.PrerenderManifest{
		Pages: []renderx.PrerenderManifestEntry{{Path: "/x", File: "x.html"}},
	})
	assert.Error(t, err, "产物缺失应报错（manifest 与磁盘不一致）")
}
