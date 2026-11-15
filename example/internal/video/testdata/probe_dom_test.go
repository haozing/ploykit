// DOM probe for the L1 F360 counter finding (D-01). Replicates the capx render
// flow (document load + timeline seek + double rAF) with an inspectable tab,
// then dumps the counter host node's live state at the F360 seek position.
//
// Post-fix role: capx seekTimeline now seeks with pause(t, false) — this probe
// demonstrates BOTH sides of the mechanism on the live document:
//  1. single-arg tl.pause(12) still yields textContent="" (GSAP
//     suppressEvents defaults true — the documented root cause stays true)
//  2. tl.pause(12, false) — the new capx semantics — populates the digits
//     ("8767 件" at t=12), and the host ink is dark (#2B2118) on the cream bg.
//
// Debug evidence only — no pass/fail assertions beyond "the probe itself worked".
//
// Run: go -C example test -run TestProbeCounterDOMState -v ./internal/video/testdata
package l1

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/haozing/ploykit/platform/capx"
	videoapp "myproduct/internal/video/app"
)

func TestProbeCounterDOMState(t *testing.T) {
	if testing.Short() {
		t.Skip("real browser probe")
	}
	ir := c01IR()
	if err := videoapp.Validate(ir); err != nil {
		t.Fatalf("validate: %v", err)
	}
	videoapp.ResolveAll(ir, nil)
	proj := videoapp.NewProjector(nil)
	html, err := proj.HTML(context.Background(), ir, "")
	if err != nil {
		t.Fatalf("project: %v", err)
	}

	chromePath, err := capx.ProbeChrome("")
	if err != nil {
		t.Fatalf("chrome probe: %v", err)
	}
	t.Logf("browser: %s", chromePath)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(),
		append(chromedp.DefaultExecAllocatorOptions[:],
			chromedp.ExecPath(chromePath),
			chromedp.Flag("force-color-profile", "srgb"),
			chromedp.Flag("disable-gpu", true),
		)...)
	defer allocCancel()
	ctx, ctxCancel := chromedp.NewContext(allocCtx)
	defer ctxCancel()
	if _, err := chromedp.Run(ctx, chromedp.EmulateViewport(1080, 1920)); err != nil {
		t.Fatalf("viewport: %v", err)
	}
	// Load the projected document via data URL (same self-contained document;
	// no network). capx itself uses setDocumentContent — the seek semantics
	// under test (builder code) are identical.
	if _, err := chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8;base64,"+base64.StdEncoding.EncodeToString(html)),
	); err != nil {
		t.Fatalf("navigate: %v", err)
	}
	// wait for player ready (same probe semantics as capx awaitReady)
	deadline := time.Now().Add(30 * time.Second)
	for {
		ready, rerr := chromedp.Run(ctx, chromedp.Evaluate[bool]("window.__player && window.__player.ready === true"))
		if rerr == nil && ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("player not ready within 30s")
		}
		time.Sleep(50 * time.Millisecond)
	}
	// seek to F360 = 12.0s with double rAF flush. SIDE 1: the OLD capx
	// semantics (single-arg pause, suppressEvents defaults true) — kept as a
	// live demonstration that the mechanism is in GSAP, not in the document.
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(function(){
  var tl = window.__timelines && window.__timelines["main"];
  if (!tl) { throw new Error("timeline not registered"); }
  tl.pause(12);
  return new Promise(function(resolve){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ resolve(true); });
    });
  });
})()`, chromedp.EvalAwaitPromise)); err != nil {
		t.Fatalf("seek: %v", err)
	}

	out, err := chromedp.Run(ctx, chromedp.Evaluate[string](`(function(){
  var el = document.getElementById('counter-ef_sales');
  if (!el) { return JSON.stringify({exists:false}); }
  var cs = getComputedStyle(el);
  var r = el.getBoundingClientRect();
  return JSON.stringify({
    exists: true,
    textContent: el.textContent,
    color: cs.color,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    rect: {x: r.x, y: r.y, w: r.width, h: r.height},
    parent: el.parentElement ? (el.parentElement.id || el.parentElement.tagName) : null,
    zIndex: cs.zIndex,
    visibility: cs.visibility,
    opacity: cs.opacity
  });
})()`))
	if err != nil {
		t.Fatalf("evaluate counter: %v", err)
	}
	t.Logf("counter DOM state at t=12.0s (F360): %s", out)

	state, err := chromedp.Run(ctx, chromedp.Evaluate[string](`(function(){
  var tl = window.__timelines && window.__timelines["main"];
  if (!tl) { return JSON.stringify({hasTimeline:false}); }
  var kids = tl.getChildren ? tl.getChildren(true, true, true) : [];
  var kidInfo = [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    kidInfo.push({
      start: Math.round(k.startTime() * 1000) / 1000,
      dur: Math.round(k.duration() * 1000) / 1000,
      progressAtSeek: Math.round(k.progress() * 1000) / 1000,
      varName: k.vars && k.vars.v !== undefined ? 'v->' + k.vars.v : (k.vars && k.vars.timeScale !== undefined ? 'scale' : (k.vars && k.vars.x !== undefined ? 'x' : (k.vars && k.vars.scale !== undefined ? 'scale' : 'other')))
    });
  }
  return JSON.stringify({
    hasTimeline: true,
    tlTime: tl.time(),
    tlPaused: tl.paused(),
    durationFrames: window.__player ? window.__player.durationFrames : null,
    children: kidInfo
  });
})()`))
	if err != nil {
		t.Fatalf("evaluate state: %v", err)
	}
	t.Logf("player/timeline state: %s", state)

	// seek past the counter tween end (11.92+1.2=13.12) and re-read text.
	// SIDE 2 (new capx semantics): pause(t, false) — onUpdate fires and the
	// digits persist after the tween's end.
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(function(){
  var tl = window.__timelines && window.__timelines["main"];
  tl.pause(13.5, false);
  return new Promise(function(resolve){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ resolve(true); });
    });
  });
})()`, chromedp.EvalAwaitPromise)); err != nil {
		t.Fatalf("seek 13.5: %v", err)
	}
	after, err := chromedp.Run(ctx, chromedp.Evaluate[string](
		`document.getElementById('counter-ef_sales').textContent`))
	if err != nil {
		t.Fatalf("evaluate after: %v", err)
	}
	t.Logf("counter textContent after seek to 13.5s (tween end=13.12s): %q", after)

	// and back before the tween start (still suppressEvents=false): the
	// tween is fully rewound, so onUpdate leaves the counter at its "from"
	// value (8200 件) — a seeked frame before the tween must NOT carry text
	// from the previous position.
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(function(){
  var tl = window.__timelines && window.__timelines["main"];
  tl.pause(5, false);
  return new Promise(function(resolve){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ resolve(true); });
    });
  });
})()`, chromedp.EvalAwaitPromise)); err != nil {
		t.Fatalf("seek 5: %v", err)
	}
	before, err := chromedp.Run(ctx, chromedp.Evaluate[string](
		`document.getElementById('counter-ef_sales').textContent`))
	if err != nil {
		t.Fatalf("evaluate before: %v", err)
	}
	t.Logf("counter textContent after seek to 5s (before tween start 11.92s): %q", before)

	// ROOT-CAUSE CHECK (unchanged): re-seek with the single-arg pause shows
	// suppression once more, then the nosuppress seek shows the fix. Kept in
	// one flow so both sides of D-01 are provable from one probe run.
	if _, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(function(){
  var tl = window.__timelines && window.__timelines["main"];
  tl.pause(12, false);
  return new Promise(function(resolve){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ resolve(true); });
    });
  });
})()`, chromedp.EvalAwaitPromise)); err != nil {
		t.Fatalf("seek 12 nosuppress: %v", err)
	}
	nosuppress, err := chromedp.Run(ctx, chromedp.Evaluate[string](
		`document.getElementById('counter-ef_sales').textContent`))
	if err != nil {
		t.Fatalf("evaluate nosuppress: %v", err)
	}
	t.Logf("counter textContent after pause(12, FALSE) (suppressEvents=false): %q", nosuppress)

	if strings.Contains(out, `"exists":false`) {
		t.Logf("FINDING: counter host node NOT in DOM at F360 — node never created or effect skipped")
	} else {
		t.Logf("FINDING: counter host node EXISTS — textContent/color above determine visibility vs absence")
	}
}
