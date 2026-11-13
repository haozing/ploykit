package renderx

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// BuildOptions 配置 SSR bundle 的 esbuild 构建。字段与 esbuild 同名选项
// 一一对应，语义见 esbuild 文档；差异与约束写在各字段注释里。
type BuildOptions struct {
	EntryPoints []string

	AbsWorkingDir string

	NodePaths []string

	Alias map[string]string

	// Define 透传 esbuild 的构建期常量替换（标识符 → 表达式文本），给
	// vite `define` 对齐用：vite 在客户端 bundle 里替换掉的裸标识符
	// （如 `__BUILD_DATE__`），SSR bundle 若不做同一份替换，求值期就是
	// ReferenceError，预渲染整页翻车（ErrServerSuspense 的常见成因）。
	// 产品应把 vite config 里那份 define 原样映射进来，两侧同源：
	//
	//	// vite.config.ts:  define: { __BUILD_DATE__: JSON.stringify(date) }
	//	// Go 侧（cmd/render）：
	//	renderx.BuildSSRBundle(renderx.BuildOptions{
	//		Define: map[string]string{"__BUILD_DATE__": strconv.Quote(date)},
	//		// ...EntryPoints / AbsWorkingDir / NodePaths / Alias 同现状
	//	})
	//
	// 值须是合法 JS 表达式的源文本：字符串字面量要带引号（strconv.Quote /
	// JSON.stringify 的产物，非裸字符串）。process.env.NODE_ENV 由框架
	// 固定注入 `"production"`，产品键与它冲突时直接报错——SSR bundle 恒按
	// production 语义构建，覆盖它多半是把 dev/prod 轨道接错了的信号，
	// 报错比静默任选一侧赢更可查。nil/空 map 时行为与不传逐字节一致。
	Define map[string]string
}

func BuildSSRBundle(opts BuildOptions) ([]byte, error) {
	if len(opts.EntryPoints) == 0 {
		return nil, errors.New("renderx: BuildSSRBundle 需要 EntryPoints")
	}
	define, err := ssrDefine(opts.Define)
	if err != nil {
		return nil, err
	}
	result := api.Build(api.BuildOptions{
		EntryPoints:   opts.EntryPoints,
		AbsWorkingDir: opts.AbsWorkingDir,
		Bundle:        true,
		Platform:      api.PlatformNeutral,
		Format:        api.FormatIIFE,
		Define:        define,
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

const nodeEnvDefine = "process.env.NODE_ENV"

// ssrDefine 合并产品 Define 与框架固定注入的 process.env.NODE_ENV
// （恒 `"production"`）。冲突时报错而非任选一侧赢：SSR bundle 按构造只该
// 以 production 语义存在（沙箱无 process，define 消除的就是对它的引用），
// 产品试图改写它是把 dev/prod 轨道接错了的信号——静默覆盖会让错轨难以
// 追查，静默忽略又会让产品误以为生效。不传 Define 时返回只含 NODE_ENV
// 的常量映射，与历史行为逐字节一致。
func ssrDefine(product map[string]string) (map[string]string, error) {
	define := make(map[string]string, len(product)+1)
	for k, v := range product {
		if k == nodeEnvDefine {
			return nil, fmt.Errorf("renderx: BuildOptions.Define 含 %q——它由框架恒注入 \"production\"（SSR bundle 只有 production 轨），不可覆盖；请检查 vite define 是否把 dev/prod 值接反", k)
		}
		define[k] = v
	}
	define[nodeEnvDefine] = `"production"`
	return define, nil
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
