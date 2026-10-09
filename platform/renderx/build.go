package renderx

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

type BuildOptions struct {
	EntryPoints []string

	AbsWorkingDir string

	NodePaths []string

	Alias map[string]string
}

func BuildSSRBundle(opts BuildOptions) ([]byte, error) {
	if len(opts.EntryPoints) == 0 {
		return nil, errors.New("renderx: BuildSSRBundle 需要 EntryPoints")
	}

	result := api.Build(api.BuildOptions{
		EntryPoints:   opts.EntryPoints,
		AbsWorkingDir: opts.AbsWorkingDir,
		Bundle:        true,
		Platform:      api.PlatformNeutral,
		Format:        api.FormatIIFE,
		Define:        map[string]string{"process.env.NODE_ENV": `"production"`},
		JSX:           api.JSXAutomatic,
		MainFields:    []string{"module", "main"},
		NodePaths:     opts.NodePaths,
		Alias:         opts.Alias,
		Loader:        map[string]api.Loader{".css": api.LoaderEmpty},
		Sourcemap:     api.SourceMapNone,
		Write:         false,
		LogLevel:      api.LogLevelWarning,
	})
	if len(result.Errors) > 0 {
		msgs := make([]string, 0, len(result.Errors))
		for _, e := range result.Errors {
			msgs = append(msgs, e.Text)
		}
		return nil, fmt.Errorf("renderx: esbuild SSR 构建失败: %s", strings.Join(msgs, "; "))
	}
	if len(result.OutputFiles) == 0 {
		return nil, errors.New("renderx: esbuild 未产出输出文件")
	}
	return result.OutputFiles[0].Contents, nil
}

func DefaultSSRAliases(webDir, packagesDir string) map[string]string {
	nodeModules := filepath.Join(webDir, "node_modules")
	return map[string]string{
		"react":                 filepath.Join(nodeModules, "react"),
		"react/jsx-runtime":     filepath.Join(nodeModules, "react", "jsx-runtime.js"),
		"react/jsx-dev-runtime": filepath.Join(nodeModules, "react", "jsx-dev-runtime.js"),
		"react-dom":             filepath.Join(nodeModules, "react-dom"),
		"react-router":          filepath.Join(nodeModules, "react-router"),
		"react-router/dom":      filepath.Join(nodeModules, "react-router", "dist", "development", "dom-export.mjs"),
		"react-router-dom":      filepath.Join(nodeModules, "react-router-dom"),

		"@tanstack/react-query": filepath.Join(nodeModules, "@tanstack", "react-query"),
		"@ploykit/ui":           filepath.Join(packagesDir, "ui", "src"),
		"@ploykit/client":       filepath.Join(packagesDir, "client", "src"),
		"@ploykit/runtime":      filepath.Join(packagesDir, "runtime", "src"),
	}
}
