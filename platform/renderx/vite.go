package renderx

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const viteDefaultEntryKey = "index.html"

type viteManifestEntry struct {
	File string   `json:"file"`
	CSS  []string `json:"css"`
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
