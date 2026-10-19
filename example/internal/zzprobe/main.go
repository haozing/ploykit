package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/haozing/ploykit/platform/renderx"
	"myproduct/internal/webrender"
)

func main() {
	wd, _ := os.Getwd()
	web := filepath.Join(wd, "web")
	aliases := webrender.AppendTanstackAliases(
		renderx.DefaultSSRAliases(web, filepath.Join(wd, "..", "packages")), web)
	bundle, err := renderx.BuildSSRBundle(renderx.BuildOptions{
		EntryPoints:   []string{filepath.Join("src", "entry-server.tsx")},
		AbsWorkingDir: web,
		NodePaths:     []string{filepath.Join(web, "node_modules")},
		Alias:         aliases,
	})
	if err != nil { panic(err) }
	p, err := renderx.NewEnginePool(bundle, renderx.PoolOptions{Prelude: webrender.TanstackPrelude()})
	if err != nil { panic(err) }
	defer p.Close()
	routes, err := p.Routes(context.Background())
	fmt.Println("routes:", len(routes), "err:", err)
	res, err := p.Render(context.Background(), "product", "/", json.RawMessage(`{}`))
	fmt.Println("html:", len(res.HTML), "err:", err)
}
