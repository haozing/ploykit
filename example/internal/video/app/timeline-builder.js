/*
 * ploykit agent video studio — timeline builder v1 (go:embed, single owner).
 *
 * Contract (docs/plan-agent-video-studio-architecture-2026-11-14.md §4.4.2/§4.4.3):
 *   window.__player  = { ready, seek(frame), play(), pause(), durationFrames }
 *   window.__timelines[compositionId] = gsap.timeline({ paused: true })
 *   gsap.ticker.lagSmoothing(0)
 *   ready resolves at document.fonts.ready && all img.decode()
 * postMessage protocol (both sides verify event.origin === window.location.origin):
 *   page → iframe: {type:"player", cmd:"seek"|"play"|"pause"|"getState", frame?}
 *   iframe → page: {type:"player:state", frame, t, durationFrames, ready}
 *
 * Motion registry v1: pulse | counter | highlight | shake | fade
 * Element animations:        move  | scaleIn | rotate | fadeIn | fadeOut
 * Adding an effect = one builder function below + IR whitelist (app/ir.go).
 *
 * Scope semantics (X-4 fix, case library §5.12/§8.2): an effect carrying
 * targetElementId acts on that element node (element-level scope); without
 * one, highlight/fade paint a z-9999 full-canvas overlay so the whole-frame
 * flash/dim is actually VISIBLE, while pulse/shake keep the legacy
 * whole-#canvas transform. Target resolution lives in effectTarget().
 */
(function () {
  'use strict';

  var IR = null;
  try {
    var dataEl = document.getElementById('ploykit-ir');
    IR = JSON.parse(dataEl.textContent);
  } catch (e) {
    console.error('ploykit-video: IR data block missing or invalid', e);
    IR = { meta: { fps: 30, width: 1080, height: 1920, durationSec: 1 }, words: [], effects: [], elements: [] };
  }

  var fps = IR.meta && IR.meta.fps ? IR.meta.fps : 30;
  var durationSec = IR.meta && IR.meta.durationSec ? IR.meta.durationSec : 0;
  if (IR.audio && IR.audio.voice && IR.audio.voice.durationSec > durationSec) {
    durationSec = IR.audio.voice.durationSec; // render baseline (§4.2.2 C5)
  }
  // Frame-count parity with the Go service (DurationFrames, delivery audit
  // P8): ceil, not round — round diverged by a frame on fractional totals
  // (e.g. 8.04s @ 30fps = 241.2 → 241 vs Go's 242).
  var durationFrames = Math.max(1, Math.ceil(durationSec * fps));

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('canvas');

  function buildClipDOM(el) {
    var node;
    if (el.type === 'image') {
      node = document.createElement('img');
      node.src = el.src;
      node.alt = '';
      node.draggable = false;
    } else if (el.type === 'text') {
      node = document.createElement('div');
      node.className = 'el-text';
      node.textContent = el.text || '';
      if (el.color) node.style.color = el.color;
      if (el.fontSize) node.style.fontSize = el.fontSize + 'px';
    } else {
      node = document.createElement('div');
      node.className = 'el-shape';
      if (el.color) node.style.background = el.color;
    }
    node.id = el.id;
    node.className = (node.className ? node.className + ' ' : '') + 'el';
    node.style.left = el.x + 'px';
    node.style.top = el.y + 'px';
    if (el.w) node.style.width = el.w + 'px';
    if (el.h) node.style.height = el.h + 'px';
    node.style.zIndex = String(1 + (el.z || 0));
    // Element time window (P0-1, case library §5.16 / T-09): a windowed
    // element starts INVISIBLE so frames before startFrame are clean — the
    // window sets on the timeline re-show it exactly at startFrame (below).
    // Only visibility is touched here, never transform: entrance animations
    // (scaleIn from 0 / move offscreen) keep owning the transform axis, the
    // window owns the visibility axis — the two compose without fighting
    // (§3.1.4 expected combination: hidden → window opens at startFrame →
    // entrance transform plays inside the open window). Elements without a
    // window keep the legacy always-mounted, always-visible behavior.
    // Elements with a window start hidden ONLY when the window does not
    // begin at frame 0: GSAP's seek(0) does not apply a zero-duration set
    // positioned exactly at t=0, so a startFrame=0 element must stay
    // visibly mounted (the DOM default) or frame F0 renders without it
    // (C08's full-canvas el_bg went black at F0 — batch-6 finding). The
    // endFrame hide-set below still applies on every seek ≥ its position.
    if (typeof el.startFrame === 'number' && el.startFrame > 0) {
      node.style.visibility = 'hidden';
    } else if (typeof el.startFrame !== 'number' && typeof el.endFrame === 'number') {
      // endFrame-only window (visible from the top, hidden at endFrame):
      // same reasoning — start mounted, the tl.set hides it at tEnd.
      node.style.visibility = 'visible';
    }
    canvas.appendChild(node);
    return node;
  }

  // Frame → seconds on the global timeline (§7.0 clock: frame = ceil(t ×
  // fps) means t = frame / fps round-trips the same clock the anchor path
  // uses). startFrame/endFrame are frame numbers on THIS timeline — the
  // same global axis words resolve onto — not per-element offsets.
  function frameTime(frame) { return frame / fps; }

  // word start time (t, seconds) for a resolved anchor
  function anchorTime(resolved) {
    if (!resolved || resolved.wordIndex < 0) return 0;
    var w = (IR.words || [])[resolved.wordIndex];
    return w ? w.start : 0;
  }

  // word end time (t, seconds) for a resolved anchor (T-12: the text-color
  // highlight window runs from the word's start to its end).
  function wordEndTime(resolved) {
    if (!resolved || resolved.wordIndex < 0) return 0;
    var w = (IR.words || [])[resolved.wordIndex];
    return w ? (w.end || w.start) : 0;
  }

  /* ---- motion registry v1 (§4.4.2) ----
   *
   * Scope semantics per effect (X-4, case library §5.12/§8.2 — batches 1-3
   * proved highlight/pulse/shake/fade painted #canvas behind the full-canvas
   * el_bg shape: amber=0 at the C04 F916 peak, pulse was a whole-canvas
   * 1.06 scale, fade dimmed everything invisibly):
   *   - fx.targetElementId names an existing element node → element-level
   *     scope: highlight flashes the node's background, pulse scales the
   *     node, shake jitters the node, fade sets the node's opacity.
   *   - no target (legacy IR) → highlight/fade paint a full-canvas OVERLAY
   *     at z-index 10000 (above every element layer and the counter's 9999),
   *     appended at effect start and removed at effect end — the whole-frame
   *     flash is finally visible instead of being occluded by el_bg. This is
   *     a deliberate pixel behavior change vs the pre-X-4 builder (invisible
   *     → visible) — the point of the fix. pulse/shake keep the legacy
   *     whole-#canvas transform (a canvas-wide scale/jitter is already the
   *     documented reading of a target-less pulse/shake).
   * Not in scope this round: word/text coloring (the T-01-level "highlight
   * colors the words" upgrade) — highlight flash is a background flash.
   */

  // resolve an effect's target node: the element node when targetElementId
  // resolves on the canvas, else null (canvas-scope fallback).
  function effectTarget(fx) {
    if (!fx.targetElementId) return null;
    var node = document.getElementById(fx.targetElementId);
    if (!node && window.console) {
      console.warn('ploykit-video: effect ' + fx.id + ' targetElementId "' +
        fx.targetElementId + '" not on canvas — falling back to canvas scope');
    }
    return node || null;
  }

  // element kind for an id, from the IR element table ("text" | "shape" |
  // "image" | null when the id is not an element). T-12: highlight needs the
  // kind to pick its color target (textColor on text nodes vs backgroundColor
  // everywhere else); the effect loop passes real nodes through effectTarget
  // and overlays/counter hosts are NOT elements, so the null path keeps them
  // on the background semantics without extra dispatch.
  function elementKindOf(id) {
    var els = IR.elements || [];
    for (var i = 0; i < els.length; i++) {
      if (els[i] && els[i].id === id) return els[i].type || null;
    }
    return null;
  }

  // full-canvas overlay host for target-less highlight/fade (X-4). One overlay
  // per effect id, z-index 10000 (elements are 1+el.z; the counter host is
  // 9999), pointer-events none, so the flash paints over everything. The
  // overlay persists for the document lifetime (append once, tween to
  // transparent) — a remove-on-end callback would fight GSAP's scrub/seek
  // model: seeked-back frames must re-show the flash deterministically, and
  // a fixed hidden element keeps every frame of the timeline reproducible.
  function canvasOverlay(fx) {
    var id = 'fx-overlay-' + fx.id;
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.style.position = 'absolute';
      node.style.left = '0';
      node.style.top = '0';
      node.style.width = '100%';
      node.style.height = '100%';
      node.style.zIndex = '10000';
      node.style.pointerEvents = 'none';
      canvas.appendChild(node);
    }
    return node;
  }

  var effectBuilders = {
    // pulse: element-level scale wave on the target node; target-less keeps
    // the legacy whole-#canvas scale (X-4: canvas scope retained by design —
    // a full-frame breathing beat).
    pulse: function (tl, node, fx, at) {
      var scale = (fx.params && fx.params.scale) || 1.2;
      tl.to(node, { scale: scale, duration: 0.18, ease: 'power2.out' }, at)
        .to(node, { scale: 1, duration: 0.3, ease: 'power2.inOut' }, at + 0.18);
    },
    counter: function (tl, node, fx, at) {
      var from = fx.params && typeof fx.params.from === 'number' ? fx.params.from : 0;
      var to = fx.params && typeof fx.params.to === 'number' ? fx.params.to : 100;
      var suffix = (fx.params && fx.params.suffix) || '';
      var obj = { v: from };
      tl.to(obj, {
        v: to, duration: Math.min(1.2, Math.max(0.3, durationSec - at)),
        ease: 'power1.out', onUpdate: function () { node.textContent = Math.round(obj.v) + suffix; }
      }, at);
    },
    // highlight (T-12 complete form, case library §5.12 / §3.1.4 C01): on a
    // TEXT element the effect colors the node's TEXT — textColor tweens from
    // the element's own color to params.color at the anchor word's START and
    // falls back at the word's END (the effect window is the word window, NOT
    // the legacy 0.25s flash rhythm — a word timed 1s→3s must read as colored
    // across that whole span; that is C01's acceptance semantics). The
    // builder paints each text element as ONE node (no per-word spans — the
    // T-01-level word-split upgrade is deliberately out of scope this round),
    // so the granularity is the whole text element: C01's three highlights
    // each target a separate card-title element, so element-granularity
    // coloring satisfies the documented expectation. The background-flash
    // branch (X-4) is unchanged below and stays the path for shape/image
    // targets and for the target-less overlay: textColor on those would be
    // invisible (shapes and the overlay have no text). Deliberately .to()
    // both legs (not fromTo): fromTo's immediateRender would restyle color
    // at build time; to() resumes from the node's current value on every
    // seek/scrub — deterministic across seeks.
    highlight: function (tl, node, fx, at) {
      var color = (fx.params && fx.params.color) || '#ffd54f';
      if (elementKindOf(fx.targetElementId) === 'text') {
        // text-color semantics: orig = the element's own color (the IR color
        // buildClipDOM applied, else the .el-text stylesheet default #fff).
        var orig = node.style.color || 'rgb(255, 255, 255)';
        var end = wordEndTime(fx.resolvedFrom);
        if (end > at) {
          // word window: rise 0.25s from word start, hold to word end
          // (minus a 0.6s tail inside the window for the settle-back).
          tl.to(node, { color: color, duration: 0.25, ease: 'power2.out' }, at)
            .to(node, { color: orig, duration: 0.6 }, Math.max(at + 0.3, end - 0.6));
        } else {
          // degenerate/zero-length word: fall back to the flash rhythm
          tl.to(node, { color: color, duration: 0.25, ease: 'power2.out' }, at)
            .to(node, { color: orig, duration: 0.6 }, at + 0.5);
        }
        return;
      }
      // background flash — the node's backgroundColor tweens to params.color
      // and back to the node's OWN background (shape/image/overlay targets;
      // legacy rhythm unchanged for X-4/L2 back-compat).
      var orig = node.style.backgroundColor || node.style.background || 'transparent';
      tl.to(node, { backgroundColor: color, duration: 0.25, ease: 'power2.out' }, at)
        .to(node, { backgroundColor: orig, duration: 0.6 }, at + 0.5);
    },
    shake: function (tl, node, fx, at) {
      var intensity = (fx.params && fx.params.intensity) || 8;
      var dur = 0.08;
      tl.to(node, { x: '+=' + intensity, duration: dur, yoyo: true, repeat: 5, ease: 'none' }, at)
        .to(node, { x: '0', duration: dur }, at + dur * 6);
    },
    // fade: element-level opacity (the node settles at params.opacity);
    // the target-less path is handled at dispatch (black cover overlay with
    // inverted polarity — see the effects loop below).
    fade: function (tl, node, fx, at) {
      var opacity = fx.params && typeof fx.params.opacity === 'number' ? fx.params.opacity : 0;
      tl.fromTo(node, { opacity: 1 }, { opacity: opacity, duration: 0.6, ease: 'power2.out' }, at);
    }
  };

  var animBuilders = {
    move: function (tl, node, an, at) {
      var from = an.from || { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
      var to = an.to || { x: from.x, y: from.y };
      tl.fromTo(node,
        { x: from.x - parseFloat(node.style.left || 0), y: from.y - parseFloat(node.style.top || 0) },
        { x: to.x - parseFloat(node.style.left || 0), y: to.y - parseFloat(node.style.top || 0),
          duration: an.durationFrames / fps, ease: an.easing || 'power2.out' }, at);
    },
    scaleIn: function (tl, node, an, at) {
      var fromV = typeof an.fromValue === 'number' ? an.fromValue : 0;
      var toV = typeof an.toValue === 'number' ? an.toValue : 1;
      tl.fromTo(node, { scale: fromV, transformOrigin: '50% 50%' },
        { scale: toV, duration: an.durationFrames / fps, ease: an.easing || 'back.out' }, at);
    },
    rotate: function (tl, node, an, at) {
      var fromV = typeof an.fromValue === 'number' ? an.fromValue : 0;
      var toV = typeof an.toValue === 'number' ? an.toValue : 360;
      tl.fromTo(node, { rotation: fromV, transformOrigin: '50% 50%' },
        { rotation: toV, duration: an.durationFrames / fps, ease: an.easing || 'linear' }, at);
    },
    // fadeIn/fadeOut (P0-2, case library §5.16): element-level opacity
    // animation — autoAlpha (opacity + visibility) so the element also drops
    // out of hit-testing while faded and visibility restores cleanly on
    // reverse seeks; renders identically to plain opacity in screenshots.
    //
    // Coordination rule with the P0-1 element time window (the tl.set
    // visibility calls in the element loop): ORTHOGONAL AXES BY DESIGN.
    //   - The window owns VISIBILITY (set at startFrame/endFrame); fadeIn/
    //     fadeOut own OPACITY (fromTo across their duration). GSAP composes
    //     them independently — a hidden window phase gates the element
    //     regardless of opacity, and inside the open window the opacity
    //     tween plays without touching visibility.
    //   - One caveat: fromTo with autoAlpha writes visibility too (autoAlpha
    //     drives opacity AND visibility when opacity hits 0). If a fadeIn
    //     overlaps the window's hidden phase (anchor earlier than
    //     startFrame), the tween's visibility write and the window's set are
    //     both live at that frame — GSAP's overwrite:auto + write order (the
    //     set sits at a later timeline position) lets the window set win
    //     until startFrame, after which the tween re-owns both properties
    //     every frame it is active. The documented combination — anchor the
    //     fadeIn AT startFrame — never overlaps, so no conflict exists on
    //     the intended authoring path. seeks re-evaluate the same order
    //     deterministically.
    fadeIn: function (tl, node, an, at) {
      tl.fromTo(node, { autoAlpha: 0 },
        { autoAlpha: 1, duration: an.durationFrames / fps, ease: an.easing || 'power2.out' }, at);
    },
    fadeOut: function (tl, node, an, at) {
      tl.fromTo(node, { autoAlpha: 1 },
        { autoAlpha: 0, duration: an.durationFrames / fps, ease: an.easing || 'power2.out' }, at);
    }
  };

  var timelines = {};
  var decodePromises = [];

  function build() {
    // one paused timeline per composition id; v1 has a single composition.
    var tl = gsap.timeline({ paused: true });

    (IR.elements || []).forEach(function (el) {
      // read-time tolerance (§4.2.3): unknown element types are skipped
      if (!el || !el.id) return;
      var node = buildClipDOM(el);
      // Element time window (P0-1): zero-duration visibility sets on the
      // main timeline. tl.set is deterministic under seek (a set is a 0s
      // tween — scrubbing to any frame re-applies exactly the sets whose
      // time is <= that frame, in order), so hide/show survives arbitrary
      // seek directions, unlike callbacks (onStart/onComplete) which only
      // fire on play-through and desync on seeks. Defaults: startFrame 0
      // (visible from the top), endFrame = durationFrames (never re-hidden),
      // so startFrame-only and endFrame-only IRs both behave.
      //
      // Composition with entrance animations (§3.1.4 expected behavior): the
      // window set owns VISIBILITY only; entrance animations (scaleIn/move/
      // rotate/fadeIn) own TRANSFORM/OPACITY and are anchored at word times
      // that land inside the open window. Stacking order at one frame:
      //   - before startFrame  → visibility:hidden, no transform applied yet
      //   - at/after startFrame → visible; a scaleIn anchored at startFrame
      //     scales the node up from 0 INSIDE the visible window (autoAlpha
      //     would couple opacity into this; plain visibility leaves entrance
      //     opacity animations like fadeIn free to animate opacity alone)
      //   - at endFrame        → visibility:hidden again (any exit transform
      //     is moot; the element is gone)
      if (typeof el.startFrame === 'number' || typeof el.endFrame === 'number') {
        var tStart = typeof el.startFrame === 'number' ? frameTime(el.startFrame) : 0;
        var tEnd = typeof el.endFrame === 'number' ? frameTime(el.endFrame) : frameTime(durationFrames);
        // Half-frame epsilon on the visible set: GSAP's seek(0) does NOT
        // apply a zero-duration set positioned exactly at t=0 (the playhead
        // sits BEFORE the set at that instant), so a startFrame=0 element —
        // e.g. C08's full-canvas el_bg — rendered black on the first frame
        // while every later frame was correct (batch-6 finding, F0 black /
        // F15+ red). Placing the set INSIDE frame 0 makes seek(0) land
        // after it. The half-frame is below any seek grid (frame k seeks to
        // k/fps, and epsilon < 1/fps), so no frame skips past it.
        tl.set(node, { visibility: 'visible' }, tStart + 1 / (fps * 2));
        if (tEnd > tStart) {
          tl.set(node, { visibility: 'hidden' }, tEnd);
        } else {
          // collapsed/empty window (startFrame === endFrame): never visible;
          // hide right after the epsilon-visible set (one frame wide).
          tl.set(node, { visibility: 'hidden' }, tStart + 1 / fps);
        }
      }
      if (el.type === 'image' && node.decode) {
        // Resource failure is FAIL-CLOSED (Remotion delayRender semantics;
        // delivery audit Q3): a broken asset must NOT yield a "successful"
        // video with holes. The rejection is recorded on __player.error and
        // keeps ready=false, so the renderer aborts with the root cause.
        decodePromises.push(node.decode().catch(function (e) {
          var msg = 'image decode failed: ' + (el.src || el.id) + (e ? ': ' + e : '');
          if (window.console) console.error('ploykit-video: ' + msg);
          if (window.__player && !window.__player.error) {
            window.__player.error = msg;
          }
          throw e; // keep the all-decode gate rejecting → ready stays false
        }));
      }
      (el.animations || []).forEach(function (an) {
        var builder = animBuilders[an.type];
        if (!builder) {
          if (window.console) console.warn('ploykit-video: unknown animation type skipped: ' + an.type);
          return; // unknown animation type: skip (read-time tolerance)
        }
        builder(tl, node, an, an.resolvedFrom && an.resolvedFrom.wordIndex >= 0 ? anchorTime(an.resolvedFrom) : 0);
      });
    });

    (IR.effects || []).forEach(function (fx) {
      // word-anchored effects attach to a marker div so they can target the
      // timeline even without a DOM element of their own.
      var builder = effectBuilders[fx.type];
      if (!builder) {
        if (window.console) console.warn('ploykit-video: unknown effect type skipped: ' + fx.type);
        return;
      }
      var at = anchorTime(fx.resolvedFrom);
      if (fx.resolvedFrom && fx.resolvedFrom.reason === 'missing') return; // unresolved: skip (§4.2.4)
      // X-4 target dispatch: counter keeps its host builder; highlight/fade
      // fall back to the z-10000 canvas overlay when there is no element
      // target (visible whole-frame flash instead of the occluded #canvas
      // paint); pulse/shake fall back to #canvas (legacy whole-layer scope).
      var target;
      if (fx.type === 'counter') {
        target = counterHost(fx);
      } else {
        target = effectTarget(fx);
        if (!target && fx.type === 'highlight') {
          target = canvasOverlay(fx);
        } else if (!target && fx.type === 'fade') {
          // fade inverts on the overlay: the cover starts transparent and
          // rises to (1 - params.opacity) black — dimming the frame to the
          // requested residual opacity is the same visual as fading #canvas
          // itself, but as a layer el_bg cannot occlude.
          var ov = canvasOverlay(fx);
          ov.style.background = '#000';
          var op = fx.params && typeof fx.params.opacity === 'number' ? fx.params.opacity : 0;
          tl.fromTo(ov, { opacity: 0 },
            { opacity: 1 - op, duration: 0.6, ease: 'power2.out' }, at);
          return;
        } else if (!target) {
          target = canvas;
        }
      }
      builder(tl, target, fx, at);
    });

    timelines['main'] = tl;
    gsap.ticker.lagSmoothing(0);

    var frame = 0;
    function seek(f) {
      f = Math.max(0, Math.min(durationFrames, Math.round(f)));
      frame = f;
      tl.pause(f / fps);
      postState();
    }
    function play() { tl.play(frame / fps); postState(); }
    function pause() { tl.pause(frame / fps); postState(); }

    window.__player = {
      ready: false,
      error: null, // first fatal resource failure (fail-closed, audit Q3)
      seek: seek,
      play: play,
      pause: pause,
      durationFrames: durationFrames
    };
    window.__timelines = timelines;

    // ready = fonts.ready + all img.decode (§4.4.2, verbatim contract)
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fonts.then(function () { return Promise.all(decodePromises); }).then(function () {
      window.__player.ready = true;
      tl.pause(0);
      postState();
    });

    // postMessage protocol (§4.4.3): strict same-origin checks both ways.
    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin) return;
      var msg = event.data;
      if (!msg || msg.type !== 'player') return;
      switch (msg.cmd) {
        case 'seek': seek(msg.frame || 0); break;
        case 'play': play(); break;
        case 'pause': pause(); break;
        case 'getState': postState(); break;
      }
    });

    function postState() {
      try {
        if (window.parent === window) return;
        window.parent.postMessage({
          type: 'player:state',
          frame: frame,
          t: frame / fps,
          durationFrames: durationFrames,
          ready: window.__player.ready
        }, window.location.origin);
      } catch (e) { /* sandboxed: state posting is best-effort */ }
    }
  }

  // counter effects need a text host node appended on the canvas.
  // Color: fx.params.color if the IR provides one, otherwise a dark ink
  // default (#2B2118). The host reuses .el-text only for typography —
  // .el-text's default white is unreadable on light card backgrounds
  // (contrast ~1.06:1 on VS-C01's cream #FFF7EE, defect D-01 second half).
  // z-index 9999: elements layer at 1 + el.z (bg el_z=0 → z-index 1); a
  // z-index:auto host would paint UNDER the full-canvas background shape and
  // the digits would be invisible even with textContent populated (observed
  // live: DOM had "8767 件" at rect 344x129 while the screenshot showed an
  // empty origin — the element layer occluded it).
  //
  // Element-level positioning (IR extension T-10 P0, case library §5.10):
  // when fx.targetElementId names an element node that exists on the canvas,
  // the host is absolutely positioned onto that element's bbox (left/top from
  // the IR geometry — the same numbers buildClipDOM applied, so no layout
  // dependency). Sizing: fixed 96px typography stays (deterministic layout,
  // no font metrics read); width/height are NOT set so the host can overflow
  // a narrow target with a long "12600 件" instead of wrapping it.
  //
  // Degradation semantics (recorded choice): the host is positioned at the
  // target's bbox but does NOT inherit the target's visibility or entrance
  // animation state — a target that has not entered yet (e.g. scaleIn from 0)
  // still shows the counter at the target's position. The counter is a
  // word-anchored stage effect that happens to borrow the target's geometry;
  // the target's animations continue to apply to the target itself only.
  function counterHost(fx) {
    var id = 'counter-' + fx.id;
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.className = 'el el-text counter';
      node.style.color = (fx.params && fx.params.color) || '#2B2118';
      node.style.zIndex = '9999';
      var targetEl = fx.targetElementId ? document.getElementById(fx.targetElementId) : null;
      if (targetEl) {
        // position onto the target element's bbox (IR geometry; the node is
        // appended to #canvas which is inset:0 of #stage, so left/top are
        // stage-relative — identical coordinate space to buildClipDOM)
        node.style.left = targetEl.style.left;
        node.style.top = targetEl.style.top;
      }
      canvas.appendChild(node);
    }
    return node;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
