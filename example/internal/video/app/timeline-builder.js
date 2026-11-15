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
 * Element animations:        move  | scaleIn | rotate
 * Adding an effect = one builder function below + IR whitelist (app/ir.go).
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
    canvas.appendChild(node);
    return node;
  }

  // word start time (t, seconds) for a resolved anchor
  function anchorTime(resolved) {
    if (!resolved || resolved.wordIndex < 0) return 0;
    var w = (IR.words || [])[resolved.wordIndex];
    return w ? w.start : 0;
  }

  /* ---- motion registry v1 (§4.4.2) ---- */
  var effectBuilders = {
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
    highlight: function (tl, node, fx, at) {
      var color = (fx.params && fx.params.color) || '#ffd54f';
      tl.fromTo(node,
        { backgroundColor: 'transparent' },
        { backgroundColor: color, duration: 0.25, ease: 'power2.out' }, at)
        .to(node, { backgroundColor: 'transparent', duration: 0.6 }, at + 0.5);
    },
    shake: function (tl, node, fx, at) {
      var intensity = (fx.params && fx.params.intensity) || 8;
      var dur = 0.08;
      tl.to(node, { x: '+=' + intensity, duration: dur, yoyo: true, repeat: 5, ease: 'none' }, at)
        .to(node, { x: '0', duration: dur }, at + dur * 6);
    },
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
      var target = fx.type === 'counter' ? counterHost(fx) : canvas;
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
  function counterHost(fx) {
    var id = 'counter-' + fx.id;
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.className = 'el el-text counter';
      node.style.color = (fx.params && fx.params.color) || '#2B2118';
      node.style.zIndex = '9999';
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
