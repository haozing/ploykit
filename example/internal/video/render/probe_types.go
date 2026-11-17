package render

// ProbeFrames result/input types — tag-free so both builds (probe.go under
// capx, probe_stub.go under !capx) share one shape and callers compile
// against the same signatures either way.

// ProbeOpts overrides the capture geometry; zero fields fall back to the
// IR's meta (the common probe wants the document's own geometry).
type ProbeOpts struct {
	Width  int
	Height int
	FPS    int
}

// ProbeResult is one probed frame: the PNG pixels plus (eventually) the
// seek-position DOM state.
type ProbeResult struct {
	Frame int
	PNG   []byte
	// DOMState is reserved for the same-frame element scan (id / visibility
	// / transform / opacity of every .el node). It is nil today — the
	// snapshot bridge's onFrame callback hands back PNG bytes only, so
	// populating it needs a DOM-eval hook inside platform/capx's frame loop
	// (future work; the inspectable-tab pattern of testdata/probe_dom_test.go
	// covers DOM assertions in the meantime — see the trade-off note on the
	// capx ProbeFrames implementation).
	DOMState []ElementState
}

// ElementState is one canvas element's computed state at a probe position —
// the assertion surface DOM-based verification needs (existence, visibility
// window membership, transform matrix, opacity) without reading pixels.
type ElementState struct {
	ID         string  `json:"id"`
	Visibility string  `json:"visibility"`
	Transform  string  `json:"transform,omitempty"`
	Opacity    float64 `json:"opacity"`
}
