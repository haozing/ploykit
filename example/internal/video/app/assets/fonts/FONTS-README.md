# Projector fonts (F-FNT-01)

`notosanssc-vf-subset.woff2` is the only font file embedded into the video
projector document. It is injected as a `@font-face` data URI so the projected
HTML stays self-contained (zero network, §4.4.5) and the font variable
disappears across Windows / preview / render-image environments.

## Source and license

| | |
|---|---|
| Font | Noto Sans SC **variable** (wght 100–900), version 2.04 |
| Source file | `C:\Windows\Fonts\NotoSansSC-VF.ttf` (Windows bundled Noto Sans SC; upstream: Google [noto-cjk](https://github.com/notofonts/noto-cjk), Sans VF) |
| License | SIL Open Font License 1.1 (`name` table nameID 13 in the source file; redistribution and subsetting permitted) |
| NOT embedded | Microsoft YaHei (`msyh.ttc`), PingFang SC — Windows/macOS system fonts with redistribution restrictions |

One variable font covers all weights: the `wght` axis (100–900) survives
subsetting, so `font-weight: 400 900` in `@font-face` resolves real weights
(no synthetic bold). This replaces the plan's three-static-weight sketch
(§3.2: Regular 500 / Bold 700 / Black 900 as separate OTFs).

## Subset character set

`chars.txt` (sha256 of the UTF-8 bytes, no trailing newline) — regenerate with
`python tools/fontsubset.py`, which prints the digest:

```
78e9bd64370210291798e2277d7b8fa30011c04dffa7534d82e8bf3ec49f6a7d
```

Composition (948 code points):
- every char in `testdata/ir/*.degraded.json` (script + words + element text, cases c02–c09)
- every string literal consumed by the C01 inline harness
  (`testdata/l1_render_test.go` Text:/Script:/suffix) and the case library
  (`app/l0_case_library_test.go`)
- the kinsoku tables in `app/subtitle.go` (`lineHeadForbidden` /
  `lineTailForbidden`) — every char line-breaking may move to a line edge
- safety margin: ASCII 0x20–0x7E, CJK punctuation U+3000–303F, fullwidth
  forms U+FF00–FFEF, plus `¥ — … · λ ⁴ ① ② ③`

Unassigned code points inside the U+FF00–FFEF margin block have no glyph in
the source font either — coverage of assigned code points is complete
(verified: every `chars.txt` char present in the subset cmap, 932 glyphs).

The subset guarantees the nine-case golden determinism path only. User
projects can input arbitrary text; glyphs outside `chars.txt` fall through the
CSS fallback chain (and later get a real missing-glyph check — F-FNT-01
second half, not in scope here).

## Regenerating

```
python -m pip install fonttools brotli   # brotli is required for woff2
python tools/fontsubset.py               # rebuilds chars.txt + prints digest
python -m fontTools.subset C:/Windows/Fonts/NotoSansSC-VF.ttf \
  --text-file=example/internal/video/app/assets/fonts/chars.txt \
  --flavor=woff2 --layout-features='*' --no-hinting \
  --output-file=example/internal/video/app/assets/fonts/notosanssc-vf-subset.woff2
```

Artifact size: 217 KB (subset of the 10.9 MB VF source).

**Charset change ⇒ chars.txt digest change ⇒ all golden frames affected by
the font must be regenerated as a full batch** (M3 plan §3.2 / §7.7). The
digest is not yet recorded in render meta.json (F-DET-01 tracks that field).
