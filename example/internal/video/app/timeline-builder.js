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

  // applyTextGradient：把梯度声明写到给定节点（父元素或逐词/逐字 span）。
  function applyTextGradient(target, g) {
    var stops = g.stops.map(function (s) {
      return s.color + ' ' + (s.offset * 100) + '%';
    }).join(', ');
    target.style.background = g.type === 'radial'
      ? 'radial-gradient(circle at ' + (g.atX || 50) + '% ' + (g.atY || 50) + '%, ' + stops + ')'
      : 'linear-gradient(' + (g.angle || 0) + 'deg, ' + stops + ')';
    target.style.webkitBackgroundClip = 'text';
    target.style.backgroundClip = 'text';
    target.style.color = 'transparent';
  }

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
      // Text styling (2026-11-18, design pass): brand font selection rides
      // the font rules the projector emits from ir.fontAssets — the
      // family still gets the vendored Noto subset as its first fallback so
      // a missing face degrades to the deterministic default, never to a
      // system-font lottery. The other knobs are plain style writes, only
      // emitted when present (legacy IRs byte-identical).
      if (el.fontFamily) {
        node.style.fontFamily = '"' + el.fontFamily + '", "Noto Sans SC Sub", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
      }
      if (el.fontWeight) node.style.fontWeight = String(el.fontWeight);
      if (el.letterSpacing) node.style.letterSpacing = el.letterSpacing + 'px';
      if (el.lineHeight) node.style.lineHeight = String(el.lineHeight);
      if (el.textAlign) node.style.textAlign = el.textAlign;
      // Die-cut outline: -webkit-text-stroke paints a CENTERED stroke that
      // eats ~half of the fill unless paint-order: stroke fill pushes the
      // fill back on top — browser-verified in the render Chrome: without
      // paint-order a 10px stroke hollows 104px Baloo glyphs out completely.
      if (el.strokeColor && el.strokeWidth) {
        node.style.webkitTextStroke = el.strokeWidth + 'px ' + el.strokeColor;
        node.style.paintOrder = 'stroke fill';
      }
      if (el.textShadow) {
        var ts = el.textShadow;
        node.style.textShadow = (ts.x || 0) + 'px ' + (ts.y || 0) + 'px ' +
          (ts.blur || 0) + 'px ' + (ts.color || 'rgba(0,0,0,0.35)');
      }
      // 渐变文字填充（2026-11-18，设计批 2）：background-clip:text 把渐变当
      // 字形填充。与逐字动效同用时，渐变改画在**词/字 span 自己身上**
      // （2026-11-18 实测：span 上的 transform 会打碎父元素的 clip；span 自持
      // clip 时 transform 正常）。竖向渐变（180deg）逐字重画与整行连续渐变
      // 视觉等价；横向渐变会逐字重新起坡（文档已注明）。
      if (el.textGradient && el.textGradient.stops && el.textGradient.stops.length >= 2) {
        if (!el.textReveal) applyTextGradient(node, el.textGradient);
        else node.style.color = 'transparent'; // 渐变由 span 承载
      }
      // 逐词切分（2026-11-18，设计批 2）：作者只写一句话，词距/换行/对齐
      // 仍由浏览器排版；每个词一个 inline-block span，入场时间线在 build()
      // 里按 stagger 排。白空格用文本节点保留（pre-wrap 下渲染为词距）。
      if (el.textReveal) {
        var words = String(el.text || '').split(/\s+/).filter(function (w) { return w.length > 0; });
        var byChar = el.textReveal.split === 'chars';
        node.textContent = '';
        node.__revealWords = [];
        words.forEach(function (w, wi) {
          // 词壳（inline-block，保住按词换行）；词模式下壳就是动画单元，
          // 字符模式下动画单元是壳内的逐字 span（字间 kerning 丢失是可接受
          // 的代价——display 标题本来就是逐字动效的视觉）。
          var wordSpan = document.createElement('span');
          wordSpan.style.display = 'inline-block';
          wordSpan.style.whiteSpace = 'pre';
          if (byChar) {
            Array.from(w).forEach(function (ch) {
              var cs = document.createElement('span');
              cs.textContent = ch;
              cs.style.display = 'inline-block';
              if (el.textGradient && el.textGradient.stops) applyTextGradient(cs, el.textGradient);
              wordSpan.appendChild(cs);
              node.__revealWords.push(cs);
            });
          } else {
            wordSpan.textContent = w;
            if (el.textGradient && el.textGradient.stops) applyTextGradient(wordSpan, el.textGradient);
            node.__revealWords.push(wordSpan);
          }
          node.appendChild(wordSpan);
          if (wi < words.length - 1) node.appendChild(document.createTextNode(' '));
        });
      }
    } else {
      node = document.createElement('div');
      node.className = 'el-shape';
      // Gradient supersedes the flat color (same CSS property); stops were
      // whitelisted at write time, so concatenation is safe.
      if (el.gradient && el.gradient.stops && el.gradient.stops.length >= 2) {
        var g = el.gradient;
        var stops = g.stops.map(function (s) {
          return s.color + ' ' + (s.offset * 100) + '%';
        }).join(', ');
        if (g.type === 'radial') {
          node.style.background = 'radial-gradient(circle at ' +
            (g.atX || 50) + '% ' + (g.atY || 50) + '%, ' + stops + ')';
        } else {
          node.style.background = 'linear-gradient(' + (g.angle || 0) + 'deg, ' + stops + ')';
        }
      } else if (el.color) {
        node.style.background = el.color;
      }
      if (el.radius !== undefined) node.style.borderRadius = el.radius + 'px';
    }
    if (el.opacity) node.style.opacity = String(el.opacity);
    node.id = el.id;
    node.className = (node.className ? node.className + ' ' : '') + 'el';
    // Clip wrapper (2026-11-17, camera gap — spotdiff hunt-drift / rain-pilot
    // 运镜缓推): el.clip is a FIXED camera window in canvas coordinates. A
    // clip-path on the element node itself would ride the element's own
    // transform (browser-verified: at scale=2 a local clip [100,200]×[100,300]
    // rendered as [0,200]×[0,400]), so the window is realized as an
    // UNTRANSFORMED wrapper div positioned at the clip rect; the element
    // mounts INSIDE it with left/top rebased by (clip.x, clip.y), and every
    // animation (scaleIn/rotate/move/pulse) plays inside the fixed window —
    // the "卡框内房间相机" semantics. z-index moves to the wrapper (painting
    // order is a wrapper property now). Elements without el.clip mount bare
    // exactly as before — zero behavior change for legacy IRs.
    var mount = node;
    if (el.clip) {
      var wrap = document.createElement('div');
      wrap.id = 'clipwrap-' + el.id;
      wrap.className = 'el-clipwrap';
      wrap.style.left = el.clip.x + 'px';
      wrap.style.top = el.clip.y + 'px';
      wrap.style.width = el.clip.w + 'px';
      wrap.style.height = el.clip.h + 'px';
      wrap.style.clipPath = 'inset(0px round ' + el.clip.radius + 'px)';
      // 双保险裁剪（2026-11-18，扫光试点实测）：内层节点带 will-change/
      // transform 会自成合成层，Chromium 的祖先 clip-path 不保证裁到合成
      // 层边缘——光带会漏到窗外的暗底上。overflow:hidden + 同半径
      // border-radius 是合成安全的裁剪（圆角跟随），两条并用零副作用；
      // 旧 IR 无 clip → 不生成 wrapper，投影字节不变。
      wrap.style.overflow = 'hidden';
      if (el.clip.radius) wrap.style.borderRadius = el.clip.radius + 'px';
      // 内层不做 layer promotion（2026-11-18）：窗内元素每帧都被 seek 重绘，
      // will-change 的合成层收益为零，反而在 CDP 截图路径下多一个"合成层
      // 与祖先裁剪谁先生效"的变量。显式降回 auto。
      node.style.willChange = 'auto';
      wrap.style.zIndex = String(1 + (el.z || 0));
      node.style.left = (el.x - el.clip.x) + 'px';
      node.style.top = (el.y - el.clip.y) + 'px';
      wrap.appendChild(node);
      mount = wrap;
    } else {
      node.style.left = el.x + 'px';
      node.style.top = el.y + 'px';
    }
    if (el.w) node.style.width = el.w + 'px';
    if (el.h) node.style.height = el.h + 'px';
    if (!el.clip) node.style.zIndex = String(1 + (el.z || 0));
    // transformOrigin (2026-11-17, camera/group-transform gap): written to
    // the element node's style; GSAP tweens inherit the node's
    // transform-origin when their vars don't carry one (browser-verified), so
    // scaleIn/rotate/pulse follow the element's own origin with zero changes
    // in animBuilders. Empty = CSS default 50% 50% (v1 behavior unchanged).
    if (el.transformOrigin) node.style.transformOrigin = el.transformOrigin;
    // mixBlendMode (2026-11-17, day-pilot 色温 groundwork): the element
    // blends with what it paints over. WITHOUT a clip wrapper it lands on
    // the element node itself. WITH one it must move to the WRAPPER: a
    // clip-path element forms an isolated group, so a blend on the inner
    // node would only blend against the (transparent) wrapper interior and
    // silently no-op (browser-verified: multiply-white showed opaque white
    // instead of identity inside a clip-path wrapper). #canvas carries
    // isolation:isolate (projector CSS) so blends never leak past the stage.
    if (el.mixBlendMode) {
      if (el.clip) mount.style.mixBlendMode = el.mixBlendMode;
      else node.style.mixBlendMode = el.mixBlendMode;
    }
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
    // The visibility style (and the timeline sets below) stay on the
    // ELEMENT node even when a clip wrapper exists: hiding the child hides
    // the wrapper's paint (an empty wrapper clips nothing visible).
    if (typeof el.startFrame === 'number' && el.startFrame > 0) {
      node.style.visibility = 'hidden';
    } else if (typeof el.startFrame !== 'number' && typeof el.endFrame === 'number') {
      // endFrame-only window (visible from the top, hidden at endFrame):
      // same reasoning — start mounted, the tl.set hides it at tEnd.
      node.style.visibility = 'visible';
    }
    canvas.appendChild(mount);
    return node;
  }

  // clipOrigin returns the canvas-coordinate rebase a node's left/top carry
  // when it mounts inside a clip wrapper (0,0 when bare-mounted). The wrapper
  // is identified by the id buildClipDOM assigns; its parsed left/top ARE the
  // clip window origin in canvas coordinates.
  function clipOrigin(node) {
    if (!node || !node.parentNode) return { x: 0, y: 0 };
    var p = node.parentNode;
    if (p.id && p.id.indexOf('clipwrap-') === 0) {
      return { x: parseFloat(p.style.left || 0), y: parseFloat(p.style.top || 0) };
    }
    return { x: 0, y: 0 };
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

  // element record for an id (the raw IR element, window fields included) —
  // fadeAnchorTime reads the owning element's startFrame/endFrame off it to
  // anchor window-scoped fadeIn/fadeOut (scriptgen windowFades contract).
  // Null when the id is not an element (overlay/counter hosts).
  function elementRecordOf(id) {
    var els = IR.elements || [];
    for (var i = 0; i < els.length; i++) {
      if (els[i] && els[i].id === id) return els[i];
    }
    return null;
  }

  // Anchor time (seconds) for one fadeIn/fadeOut:
  //   1. word-anchored (resolvedFrom wordIndex >= 0) → the word time (legacy
  //      behavior, unchanged — fade_highlight L2 fixtures pin this path);
  //   2. unanchored + the owning element carries a window → fadeIn starts at
  //      the window's startFrame, fadeOut ENDS at the window's endFrame
  //      (scriptgen contract: fades follow the card instead of piling on
  //      t=0 — the f0 double-exposure / f60 all-black root cause);
  //   3. unanchored + no window → the dispatch-computed default (0), the
  //      legacy back-compat path for hand-authored IRs.
  function fadeAnchorTime(an, node, at, isFadeIn) {
    // atFrame (v1 bridge to the v2 `at:{frame}` object, spec §2.8.1): an
    // explicit frame anchor takes precedence over BOTH fallbacks below —
    // the word anchor (write-time mutually exclusive with atFrame) and the
    // owning element's window. At dispatch the caller already passes
    // at = atFrame/fps; returning it here keeps this function independently
    // correct for the fade path (which otherwise re-derives its own time).
    if (typeof an.atFrame === 'number') return an.atFrame / fps;
    if (an.resolvedFrom && an.resolvedFrom.wordIndex >= 0) return at;
    var el = elementRecordOf(node.id);
    if (!el) return at;
    var hasWin = typeof el.startFrame === 'number' || typeof el.endFrame === 'number';
    if (!hasWin) return at;
    if (isFadeIn) {
      return typeof el.startFrame === 'number' ? el.startFrame / fps : 0;
    }
    var endF = typeof el.endFrame === 'number' ? el.endFrame : durationFrames;
    var dur = (an.durationFrames || 0) / fps;
    var t = endF / fps - dur;
    return t > 0 ? t : 0;
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
      // NOTE: the second leg's 'power2.inOut' spent all of v1 OUTSIDE the
      // ir.go easing whitelist (a hidden bug — the builder used a value
      // authors could not themselves declare); it was legalized 2026-11-17
      // alongside the author-facing whitelist entry.
      tl.to(node, { scale: scale, duration: 0.18, ease: 'power2.out' }, at)
        .to(node, { scale: 1, duration: 0.3, ease: 'power2.inOut' }, at + 0.18);
    },
    counter: function (tl, node, fx, at) {
      var from = fx.params && typeof fx.params.from === 'number' ? fx.params.from : 0;
      var to = fx.params && typeof fx.params.to === 'number' ? fx.params.to : 100;
      var suffix = (fx.params && fx.params.suffix) || '';
      // format/decimals（2026-11-17，speedrun 摩擦：毫秒计时器 "0:23.87" 在
      // 整数 tween 下不可表达）：fmt 是数字格式模板，"{v}" 占位符替换为
      // toFixed(dec) 的值，字面文本允许（"0:{v}" → "0:23.87"）；dec=0 时
      // toFixed(0) 兼容旧的 Math.round 行为。
      var fmt = (fx.params && fx.params.format) || '';
      var dec = fx.params && typeof fx.params.decimals === 'number' ? fx.params.decimals : 0;
      var finalText = fmt
        ? fmt.replace('{v}', to.toFixed(dec)) + suffix
        : to.toFixed(dec) + suffix;
      // SEEK-SAFETY, generation 2 (v0.33.2, the studio live-count chain):
      // v0.33.1's end-stamp fixed "onUpdate never fires under seek" but
      // exposed the DURATION HEURISTIC as the real defect — min(1.2, …)
      // makes dense chains OVERLAP (speedrun: later segments' tweens span
      // the playhead and onUpdate races run the count AHEAD) while the
      // stamp lands at at+1.2s (studio: the flip LAGS 36 frames). Two paths:
      //
      // DISCRETE (from === to): no tween at all — a single zero-duration
      //   tl.set at `at` itself. The value flips exactly on the anchor
      //   frame, no overlap, deterministic under arbitrary seeks (the same
      //   set mechanism the visibility windows use). This is the PNG-chain
      //   semantics precisely. t=0 caveat (same as windows): a set at
      //   exactly 0 is not applied by seek(0) — set the host element's
      //   static text to the initial value.
      //
      // CONTINUOUS (from !== to): the tween keeps onUpdate for play-mode
      //   interpolation and for tweens ACTIVE at the seek landing point;
      //   the end-stamp at at+dur recovers jumps past the whole segment.
      //   durationFrames (explicit, author-owned) replaces the heuristic
      //   when present — overlap becomes an author decision.
      if (from === to) {
        tl.set(node, { textContent: finalText }, at);
        return;
      }
      var explicit = fx.params && typeof fx.params.durationFrames === 'number' && fx.params.durationFrames > 0
        ? fx.params.durationFrames / fps : 0;
      var dur = explicit || Math.min(1.2, Math.max(0.3, durationSec - at));
      var obj = { v: from };
      tl.to(obj, {
        v: to, duration: dur, ease: 'power1.out', onUpdate: function () {
          node.textContent = fmt
            ? fmt.replace('{v}', obj.v.toFixed(dec)) + suffix
            : obj.v.toFixed(dec) + suffix;
        }
      }, at);
      tl.set(node, { textContent: finalText }, at + dur);
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
    },
    // glow（2026-11-18，设计批 2）：文本辉光的呼吸。text-shadow 为 GSAP 的
    // 复合字符串属性，blur/alpha 在 blurMin..blurMax 间 yoyo 往复。
    // repeat 由剩余时长算成**有限次**（无限循环在 seek 下没有必要且难证
    // 确定性）；t=0 的 set 兜底反向 seek。目标元素自身的静态 textShadow
    // 会被本效果接管（作者二选一）。
    glow: function (tl, node, fx, at) {
      var p = fx.params || {};
      var color = p.color || 'rgba(255,255,255,0.85)';
      var bmin = typeof p.blurMin === 'number' ? p.blurMin : 16;
      var bmax = typeof p.blurMax === 'number' ? p.blurMax : 44;
      if (bmax < bmin) { var bt = bmin; bmin = bmax; bmax = bt; }
      var period = (typeof p.periodFrames === 'number' && p.periodFrames > 0 ? p.periodFrames : 60) / fps;
      var fromFx = '0px 0px ' + bmin + 'px ' + color;
      var toFx = '0px 0px ' + bmax + 'px ' + color;
      var remain = Math.max(period, durationSec - at);
      var reps = Math.max(0, Math.floor(remain / period) - 1);
      tl.set(node, { textShadow: fromFx }, 0);
      tl.fromTo(node, { textShadow: fromFx },
        { textShadow: toFx, duration: period, ease: 'sine.inOut', yoyo: true, repeat: reps, immediateRender: false }, at);
    }
  };

  var animBuilders = {
    // move: From/To Points are ABSOLUTE canvas coordinates (v1 semantics).
    // The element's own left/top carry that same absolute position when it
    // mounts bare; inside a clip wrapper left/top are rebased by (clip.x,
    // clip.y), so clipOrigin() reconstructs the absolute anchor (adds the
    // rebase back). Legacy IRs (no wrapper) keep the exact old arithmetic.
    //
    // immediateRender: !(at > 0)（2026-11-18，disaster 格式实测）——与
    // scaleIn/rotate 同一类泄漏：元素在 move 开始前就可见时（例如 undo 段的
    // from=爆散点），GSAP 会在 build 期把 from 写进元素，早期帧停在未来状态。
    move: function (tl, node, an, at) {
      var baseX = parseFloat(node.style.left || 0) + clipOrigin(node).x;
      var baseY = parseFloat(node.style.top || 0) + clipOrigin(node).y;
      var from = an.from || { x: baseX, y: baseY };
      var to = an.to || { x: from.x, y: from.y };
      tl.fromTo(node,
        { x: from.x - baseX, y: from.y - baseY },
        { x: to.x - baseX, y: to.y - baseY,
          duration: an.durationFrames / fps, ease: an.easing || 'power2.out',
          immediateRender: !(at > 0) }, at);
    },
    // scaleIn/rotate: NO transformOrigin in the vars — GSAP inherits the
    // node's style transform-origin (browser-verified 2026-11-17), so the
    // element's own el.transformOrigin (buildClipDOM) drives the pivot.
    // Empty style = CSS default 50% 50% = the old hardcoded value, so legacy
    // IRs render identically.
    //
    // immediateRender: !(at > 0)（2026-11-18，v2 冷开场实测）——GSAP 的
    // fromTo 默认在 build 期立即写 from 值；at>0 时会让"第 0 帧就可见"的
    // 元素提前塌到 from（贴纸 1→0.1、rotate ±9°）：v1 靠元素窗口从落件帧
    // 才开始把这个问题藏住了，冷开场一开就暴露。at==0 保持 TRUE（首个
    // 动画的 from 就是编辑态），at>0 关掉（start 之前保持静态样式）。
    scaleIn: function (tl, node, an, at) {
      var fromV = typeof an.fromValue === 'number' ? an.fromValue : 0;
      var toV = typeof an.toValue === 'number' ? an.toValue : 1;
      tl.fromTo(node, { scale: fromV },
        { scale: toV, duration: an.durationFrames / fps, ease: an.easing || 'back.out',
          immediateRender: !(at > 0) }, at);
    },
    rotate: function (tl, node, an, at) {
      var fromV = typeof an.fromValue === 'number' ? an.fromValue : 0;
      var toV = typeof an.toValue === 'number' ? an.toValue : 360;
      tl.fromTo(node, { rotation: fromV },
        { rotation: toV, duration: an.durationFrames / fps, ease: an.easing || 'linear',
          immediateRender: !(at > 0) }, at);
    },
    // fadeIn/fadeOut (P0-2, case library §5.16): element-level opacity
    // animation — autoAlpha (opacity + visibility) so the element also drops
    // out of hit-testing while faded and visibility restores cleanly on
    // reverse seeks; renders identically to plain opacity in screenshots.
    //
    // ANCHORING RULE (scriptgen windowFades contract): a fadeIn/fadeOut with
    // NO startAnchor is anchored at the OWNING ELEMENT's time window —
    // fadeIn at the window's startFrame, fadeOut ending at the window's
    // endFrame — instead of t=0. The unanchored-t=0 legacy produced the two
    // live-compos symptoms: fadeOut's fromTo immediateRender wrote
    // autoAlpha=1 on EVERY card at build time (f0 double-exposure) and its
    // finished state autoAlpha=0 pressed everything invisible after the
    // tween's 0.4s (f60 all-black). Elements never carrying a window
    // (startFrame/endFrame both absent) keep the legacy t=0 anchoring
    // (back-compat with hand-authored IRs).
    //
    // Coordination rule with the P0-1 element time window (the tl.set
    // visibility calls in the element loop): ORTHOGONAL AXES BY DESIGN.
    //   - The window owns VISIBILITY (set at startFrame/endFrame); fadeIn/
    //     fadeOut own OPACITY (fromTo across their duration). GSAP composes
    //     them independently — a hidden window phase gates the element
    //     regardless of opacity, and inside the open window the opacity
    //     tween plays without touching visibility.
    //   - immediateRender:false on BOTH directions: a fromTo with the
    //     default true restyles its from-values at BUILD time — the fadeIn
    //     leg wrote autoAlpha=0 on elements whose fade lives later in the
    //     timeline (pre-window leaks visible as a sudden transparent flash
    //     on seek(0)), and the fadeOut leg wrote autoAlpha=1 over elements
    //     still inside their hidden pre-window phase (the f0 double-exposure
    //     twin). With false, from-values apply only when the playhead
    //     reaches the tween, keeping seeks deterministic and build-time
    //     state untouched.
    //   - One caveat: fromTo with autoAlpha writes visibility too (autoAlpha
    //     drives opacity AND visibility when opacity hits 0). Anchoring the
    //     fades INSIDE the open window (the documented combination) means
    //     the tween is only ever live while the window set has already
    //     made the element visible, so no conflict exists on the intended
    //     authoring path. Seeks re-evaluate the same order deterministically.
    fadeIn: function (tl, node, an, at) {
      var t = fadeAnchorTime(an, node, at, true);
      tl.fromTo(node, { autoAlpha: 0 },
        { autoAlpha: 1, duration: an.durationFrames / fps, ease: an.easing || 'power2.out',
          immediateRender: false }, t);
    },
    fadeOut: function (tl, node, an, at) {
      var t = fadeAnchorTime(an, node, at, false);
      tl.fromTo(node, { autoAlpha: 1 },
        { autoAlpha: 0, duration: an.durationFrames / fps, ease: an.easing || 'power2.out',
          immediateRender: false }, t);
    },
    // resize (v1 increment, versus pilot): width/height tween anchored
    // TOP-LEFT (progress-bar semantics — width grows rightward, height grows
    // downward; From/To Points carry (w,h) px pairs, unlike move's absolute
    // position Points).
    //
    // immediateRender: (at <= 0) — BOTH cases have a defined owner:
    //   at == 0: TRUE. A tween starting at the very top must apply its from
    //     size at build — with false, a playhead parked exactly at t=0 does
    //     not "enter" the tween and the element's static w/h shows at F0
    //     (measured: full-width bar at frame 0, the extended synthetic
    //     test's F0 verdict).
    //   at > 0: FALSE. resize is designed for CHAINED segments (one
    //     element, N sequential resizes stepping a fill up — the
    //     progress-bar choreography that motivated the type). With true,
    //     EVERY fromTo writes its from-size at build and the LAST segment's
    //     from wins, leaking a later state into early frames (v0.32.1 fix,
    //     caught while authoring the first real chained consumer).
    resize: function (tl, node, an, at) {
      if (!an.from || !an.to) return; // write-time gate rejects this; skip = read-time tolerance
      tl.fromTo(node, { width: an.from.x, height: an.from.y },
        { width: an.to.x, height: an.to.y,
          duration: an.durationFrames / fps, ease: an.easing || 'power2.out',
          immediateRender: !(at > 0) }, at);
    },
    // groupScale（2026-11-18，设计批 2）：绕**画布共享枢轴**的缩放。实现 =
    // tween 起点把本元素的 transform-origin 改写成"枢轴在元素盒内的百分比"，
    // 再缩放——N 个元素同枢轴同时序 = 一次运镜推进（无场景图也能做组变换，
    // 这是 11 片复刻里"无相机/组变换"缺口的 v1 平替）。缩放为 1 时改 origin
    // 不产生任何视觉位移，所以"入场弹入用自身中心、之后运镜换共享枢轴"可以
    // 安全叠加。immediateRender 恒 false：fromValue 应等于元素当前静止缩放
    // （作者约定，与 resize 链式分段同理），否则早期帧会泄漏未来状态。
    // tilt（2026-11-18，design batch 4）：3D 倾斜。From/To 的 Point 复用作
    // (rotateXdeg, rotateYdeg)；共享枢轴时与 groupScale 同一套 transform-origin
    // 改写，N 元素同角度同时序 = 刚性整组倾斜（#canvas 的 perspective 让每个
    // 子元素走同一个投影矩阵）。缩放为 1/角度为 0 时改 origin 无视觉位移。
    tilt: function (tl, node, an, at) {
      if (!an.from || !an.to) return; // write-time gate rejects this
      if (an.pivot) {
        var tleft = parseFloat(node.style.left || 0) + clipOrigin(node).x;
        var ttop = parseFloat(node.style.top || 0) + clipOrigin(node).y;
        var tw = parseFloat(node.style.width || 0) || node.offsetWidth || 1;
        var th = parseFloat(node.style.height || 0) || node.offsetHeight || 1;
        tl.set(node, { transformOrigin: (((an.pivot.x - tleft) / tw) * 100) + '% ' + (((an.pivot.y - ttop) / th) * 100) + '%' }, at);
      }
      tl.fromTo(node, { rotationX: an.from.x, rotationY: an.from.y },
        { rotationX: an.to.x, rotationY: an.to.y,
          duration: an.durationFrames / fps, ease: an.easing || 'power2.inOut',
          immediateRender: !(at > 0) }, at);
    },
    groupScale: function (tl, node, an, at) {
      if (!an.pivot || an.fromValue == null || an.toValue == null) return;
      var left = parseFloat(node.style.left || 0) + clipOrigin(node).x;
      var top = parseFloat(node.style.top || 0) + clipOrigin(node).y;
      var w = parseFloat(node.style.width || 0) || node.offsetWidth || 1;
      var h = parseFloat(node.style.height || 0) || node.offsetHeight || 1;
      var ox = ((an.pivot.x - left) / w) * 100;
      var oy = ((an.pivot.y - top) / h) * 100;
      tl.set(node, { transformOrigin: ox + '% ' + oy + '%' }, at);
      tl.fromTo(node, { scale: an.fromValue },
        { scale: an.toValue, duration: an.durationFrames / fps,
          ease: an.easing || 'power2.out', immediateRender: false }, at);
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
        // Half-frame epsilon on BOTH window sets (§7.0 boundary rule, twin of
        // the visible-set epsilon below). GSAP applies the sets whose time is
        // <= the seek position; a hide set at the EXACT tEnd made the shared
        // boundary frame F of adjacent windows (prev.endFrame == next
        // startFrame, scriptgen's seamless hard-cut convention) render with
        // BOTH cards hidden — the live-compos true-black bug. Offsetting the
        // hide set half a frame AFTER the whole tEnd position keeps the
        // boundary frame F showing the previous card (window is inclusive of
        // endFrame), and the very next seek (F+1) shows the next card: every
        // seek landing has exactly one card on stage. The epsilon stays below
        // the seek grid (frame k seeks to k/fps, epsilon = 1/(2*fps)), so no
        // frame skips past it — verified by the 4-window live-compos render.
        tl.set(node, { visibility: 'visible' }, tStart + 1 / (fps * 2));
        if (tEnd > tStart) {
          tl.set(node, { visibility: 'hidden' }, tEnd + 1 / (fps * 2));
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
        // Anchor precedence (atFrame v1 bridge to the v2 `at:{frame}` object,
        // spec §2.8.1): an explicit atFrame wins; without one the legacy
        // word-anchor time applies (write-time the two are mutually
        // exclusive — atFrame first keeps hand-edited IRs unambiguous).
        // Neither present → 0 (fadeIn/fadeOut additionally fall back to the
        // owning element's window inside fadeAnchorTime, which itself defers
        // to atFrame first).
        var at = 0;
        if (typeof an.atFrame === 'number') {
          at = an.atFrame / fps;
        } else if (an.resolvedFrom && an.resolvedFrom.wordIndex >= 0) {
          at = anchorTime(an.resolvedFrom);
        }
        builder(tl, node, an, at);
      });
      // TextReveal（2026-11-18，设计批 2）：逐词成句。每个词一条 fromTo，
      // 前导一个 t=0 的 set 兜底（反向 seek 回词入场前 → 回到起点态；与元素
      // 可见窗口同一机制）。span 同时写内联起点态：t=0 的 seek 不应用零时长
      // set（既有文档记载的 GSAP 边界），内联初值兜住封面帧。
      if (el.textReveal && node.__revealWords && node.__revealWords.length) {
        var trv = el.textReveal;
        var trStyle = trv.style === 'pop' ? 'pop' : 'rise';
        var trDur = (typeof trv.durationFrames === 'number' && trv.durationFrames > 0 ? trv.durationFrames : 12) / fps;
        var trStagger = (typeof trv.staggerFrames === 'number' && trv.staggerFrames >= 0 ? trv.staggerFrames : 3) / fps;
        var trEase = trv.easing || 'power3.out';
        var trDist = typeof trv.distance === 'number' && trv.distance > 0 ? trv.distance : 44;
        var trAt = (typeof trv.atFrame === 'number' ? trv.atFrame : 0) / fps;
        node.__revealWords.forEach(function (span, wi) {
          // rise 动画走 top（相对定位），**不走 transform**：浏览器实测
          // （2026-11-18）子 span 上任何 transform（含 identity translate）
          // 都会打碎父元素 background-clip:text 的渐变裁剪——文字会被画到
          // 元素左缘且错位。top 是纯绘制属性，不建立 stacking context，
          // 渐变文字与逐词上浮因此可以共存。pop 需要 scale（必须 transform），
          // 所以写时禁止 pop + textGradient 组合（ir.go 校验）。
          var fromVars, toVars;
          if (trStyle === 'pop') {
            fromVars = { opacity: 0, scale: 0.62 };
            toVars = { opacity: 1, scale: 1, duration: trDur, ease: trEase, immediateRender: false };
          } else {
            span.style.position = 'relative';
            fromVars = { opacity: 0, top: trDist };
            toVars = { opacity: 1, top: 0, duration: trDur, ease: trEase, immediateRender: false };
          }
          tl.set(span, fromVars, 0);
          span.style.opacity = '0';
          tl.fromTo(span, fromVars, toVars, trAt + wi * trStagger);
        });
      }
    });

    (IR.effects || []).forEach(function (fx) {
      // word-anchored effects attach to a marker div so they can target the
      // timeline even without a DOM element of their own.
      var builder = effectBuilders[fx.type];
      if (!builder) {
        if (window.console) console.warn('ploykit-video: unknown effect type skipped: ' + fx.type);
        return;
      }
      // Anchor precedence (effect-side atFrame, 2026-11-17 — the twin of the
      // animation dispatch above): an explicit atFrame wins and the word
      // resolution is not consulted at all (zero-word compositions are the
      // motivating case — speedrun's timer). Without one, the legacy word
      // anchor applies; an unresolved (missing) anchor still skips (§4.2.4).
      var at = 0;
      if (typeof fx.atFrame === 'number') {
        at = fx.atFrame / fps;
      } else {
        if (fx.resolvedFrom && fx.resolvedFrom.reason === 'missing') return; // unresolved: skip (§4.2.4)
        at = anchorTime(fx.resolvedFrom);
      }
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
      // suppressEvents=false — the SAME semantics capx's seekTimeline uses
      // (tl.pause(t, false), D-01). With GSAP's default true, onUpdate
      // callbacks are skipped during the seek render, so DOM-writing
      // effects (counter digits) show stale state in the probe while the
      // real render shows fresh state — probes and renders must not lie
      // differently (v0.33.2; found by the speedrun/studio chain probes).
      tl.pause(f / fps, false);
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
    // Text-element targets HOST the counter directly (v0.33.1): the effect
    // writes textContent on the target itself, so chained counter segments
    // (progress counters stepping per event, all targeting one text element)
    // share a single host and read as one continuous count. The polished
    // pilot's 31-segment chain surfaced the v0.33.0 gap: a text target only
    // POSITIONED the per-effect div, so every segment had its own invisible
    // host and the visible element never advanced past its static text.
    // Non-text targets and target-less effects keep the legacy self-hosted
    // div (positioned onto a non-text target's bbox) — byte-compat.
    var targetEl = fx.targetElementId ? document.getElementById(fx.targetElementId) : null;
    if (targetEl && elementKindOf(fx.targetElementId) === 'text') {
      return targetEl;
    }
    var id = 'counter-' + fx.id;
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.className = 'el el-text counter';
      node.style.color = (fx.params && fx.params.color) || '#2B2118';
      node.style.zIndex = '9999';
      if (targetEl) {
        // position onto the target element's bbox (IR geometry; the node is
        // appended to #canvas which is inset:0 of #stage, so left/top are
        // stage-relative — identical coordinate space to buildClipDOM). A
        // clip-wrapped target carries REBASED left/top; clipOrigin() restores
        // the absolute canvas position so the counter lands on the element,
        // not offset by the camera window.
        var co = clipOrigin(targetEl);
        node.style.left = (parseFloat(targetEl.style.left || 0) + co.x) + 'px';
        node.style.top = (parseFloat(targetEl.style.top || 0) + co.y) + 'px';
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
