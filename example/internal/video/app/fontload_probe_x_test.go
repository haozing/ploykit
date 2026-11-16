//go:build capx

package videoapp

// Manual evidence probe (F-FNT-01): drive a real headless browser over the
// SAME loading path capx uses (page.setDocumentContent) and report the
// FontFace load status + document.fonts.check() for CJK at weights 400/700.
// Not part of the regular suite: explicit -run only, skips without a browser.
//   go test -tags capx ./internal/video/app -run TestFontFaceLoad_Probe -v

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/page"

	capx "github.com/haozing/ploykit/platform/capx"
)

func TestFontFaceLoad_Probe(t *testing.T) {
	exe, cerr := capx.ProbeChrome(os.Getenv("CAPX_CHROME_PATH"))
	if cerr != nil {
		t.Skip("no Chrome/Edge found:", cerr)
	}

	ir := &IR{Meta: Meta{FPS: 25, Width: 320, Height: 180, DurationSec: 1},
		Elements: []Element{{ID: "t", Type: ElementText, Text: "标题", X: 0, Y: 0, W: 200, H: 60}}}
	html, err := NewProjector(nil).HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatal(err)
	}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(exe),
		chromedp.Flag("force-color-profile", "srgb"),
		chromedp.Flag("disable-gpu", true),
	)
	allocCtx, acancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer acancel()
	bctx, bcancel := chromedp.NewContext(allocCtx)
	defer bcancel()
	ctx, cancel := context.WithTimeout(bctx, 60*time.Second)
	defer cancel()

	// Load the document exactly like capx (setDocumentContent, no network).
	// Eagerly create the target (first Run attaches the session) — capx does
	// the same with EmulateViewport before touching cdp.Call.
	tabCtx, tcancel := chromedp.NewContext(ctx)
	defer tcancel()
	if _, err := chromedp.Run(tabCtx, chromedp.EmulateViewport(320, 180)); err != nil {
		t.Fatalf("viewport: %v", err)
	}
	cdpCtx := chromedp.FromContext(tabCtx)
	tree, err := cdp.Call(tabCtx, cdpCtx.Target, page.GetFrameTree, cdp.Empty{})
	if err != nil {
		t.Fatalf("frame tree: %v", err)
	}
	if _, err := cdp.Call(tabCtx, cdpCtx.Target, page.SetDocumentContent, page.SetDocumentContentParams{
		FrameID: tree.FrameTree.Frame.ID,
		HTML:    string(html),
	}); err != nil {
		t.Fatalf("set document: %v", err)
	}

	// fonts.ready has real semantics under @font-face: await the promise,
	// then report every FontFace's status and the CJK availability checks.
	var check400, check700 bool
	status, serr := chromedp.Run(tabCtx,
		chromedp.Evaluate[string](`(() => document.fonts.ready.then(() => {
			const faces = [...document.fonts].map(f => f.family + ':' + f.status).join(',');
			return faces;
		}))()`, chromedp.EvalAwaitPromise))
	if serr != nil {
		t.Fatalf("fonts.ready probe: %v", serr)
	}
	for _, tc := range []struct {
		weight string
		into   *bool
	}{
		{"48px \"Noto Sans SC Sub\"", &check400},
		{"700 48px \"Noto Sans SC Sub\"", &check700},
	} {
		expr := "document.fonts.check('" + tc.weight + "', '标')"
		v, verr := chromedp.Run(tabCtx, chromedp.Evaluate[bool](expr))
		if verr != nil {
			t.Fatalf("fonts.check %s: %v", tc.weight, verr)
		}
		*tc.into = v
	}
	t.Logf("FontFace status: %s", status)
	t.Logf("fonts.check 400 '标': %v", check400)
	t.Logf("fonts.check 700 '标': %v", check700)
	if status == "" || !strings.Contains(status, "loaded") {
		t.Fatalf("subset font not loaded: %q", status)
	}
	if !check400 || !check700 {
		t.Fatalf("fonts.check returned %v / %v, want true/true", check400, check700)
	}
}
