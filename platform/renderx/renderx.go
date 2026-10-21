package renderx

import (
	"encoding/json"
	"errors"
)

type Mode string

const (
	ModeStatic Mode = "static"

	ModeCSR Mode = "csr"
)

// Hydrate 是路由表投影里的第二根轴（与 Mode 正交）：服务端产出的 HTML
// 之后还要不要 JS。空串按 HydrateLoad 处理，旧路由表不声明该字段时行为
// 不变。
type Hydrate string

const (
	// HydrateLoad 注入 props 脚本 + 客户端入口，浏览器水合。
	HydrateLoad Hydrate = "load"
	// HydrateNone 两者都不注入：HTML 即终态，页面零 JS。
	HydrateNone Hydrate = "none"
)

const MaxPropsBytes = 512 << 10

type RouteSpec struct {
	Path    string  `json:"path"`
	PageID  string  `json:"pageId"`
	Render  Mode    `json:"render"`
	Hydrate Hydrate `json:"hydrate"`
}

type PagePath struct {
	Params map[string]string `json:"params,omitempty"`
}

type Params map[string]string

type Directive struct {
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Seq     int             `json:"seq"`
}

var (
	ErrPatternNotFound = errors.New("renderx: pattern not registered")

	ErrPatternMismatch = errors.New("renderx: registered pattern not in route table")

	ErrMissingPaths = errors.New("renderx: static param route missing Paths")

	ErrInvalidParam = errors.New("renderx: invalid path param")

	ErrInvalidDirective = errors.New("renderx: invalid directive payload")

	ErrInvalidHeadTag = errors.New("renderx: invalid head tag or attr name")

	ErrInvalidCacheKey = errors.New("renderx: invalid cache key")

	ErrBuildIDMismatch = errors.New("renderx: cache entry buildId mismatch")

	ErrPropsTooLarge = errors.New("renderx: props exceed size limit")

	ErrPageNotFound = errors.New("renderx: page not found")
)
