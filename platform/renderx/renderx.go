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

const MaxPropsBytes = 512 << 10

type RouteSpec struct {
	Path   string `json:"path"`
	PageID string `json:"pageId"`
	Render Mode   `json:"render"`
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
