package renderx

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const viteDefaultEntryKey = "index.html"

type viteManifestEntry struct {
	File string   `json:"file"`
	CSS  []string `json:"css"`
}

// ViteManifestFiles returns every file path the build emitted, slash-prefixed
// and sorted, for use as an authoritative content-addressed asset list
// (webx.AssetCacheManifest).
//
// Why this exists instead of relying on a filename heuristic: a build's
// manifest knows exactly which URLs carry a content hash, while any name-based
// rule has to guess and has a false-positive class that silently pins a
// replaceable file for a year (`Some-Page-Banner.png` looks like a hash;
// `CYhS-pAS` — a real hash — does not look like one to a tighter rule).
//
// Every value's `file` and `css` are collected. Note that Vite lists the file
// relative to the build root, so no path cleaning beyond the leading slash is
// performed here.
func ViteManifestFiles(data []byte) ([]string, error) {
	var m map[string]viteManifestEntry
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("renderx: manifest.json 解析失败: %w", err)
	}
	seen := make(map[string]struct{}, len(m))
	for _, e := range m {
		if e.File != "" {
			seen["/"+strings.TrimPrefix(e.File, "/")] = struct{}{}
		}
		for _, css := range e.CSS {
			if css != "" {
				seen["/"+strings.TrimPrefix(css, "/")] = struct{}{}
			}
		}
	}
	out := make([]string, 0, len(seen))
	for f := range seen {
		out = append(out, f)
	}
	sort.Strings(out)
	return out, nil
}

func ParseViteManifest(data []byte, entryKey string) (ViteAssets, error) {
	if entryKey == "" {
		entryKey = viteDefaultEntryKey
	}
	var m map[string]viteManifestEntry
	if err := json.Unmarshal(data, &m); err != nil {
		return ViteAssets{}, fmt.Errorf("renderx: manifest.json 解析失败: %w", err)
	}
	e, ok := m[entryKey]
	if !ok {
		return ViteAssets{}, fmt.Errorf(
			"renderx: manifest 缺少入口 %q（需先 cd web && npx vite build，且 build.manifest 已开启）", entryKey)
	}
	assets := ViteAssets{JS: []string{"/" + e.File}}
	for _, css := range e.CSS {
		assets.CSS = append(assets.CSS, "/"+css)
	}
	return assets, nil
}

const OutputVersion = "rv1"

func ViteBuildID(data []byte) string {
	h := sha256.New()
	h.Write([]byte(OutputVersion))
	h.Write([]byte{0})
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}
