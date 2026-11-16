#!/usr/bin/env python3
"""F-FNT-01: collect the charset for the projector font subset.

Sources (M3 plan §3.2):
  1. testdata/ir/*.degraded.json  — script, words[].text, elements[].text
  2. l1_render_test.go            — C01 inline harness (Text:/Script:/suffix strings)
  3. app/l0_case_library_test.go  — case library harness strings
  4. subtitle.go kinsoku tables   — lineHeadForbidden / lineTailForbidden
  5. Safety margin: ASCII 0x20-0x7E, U+3000-303F, U+FF00-FFEF, ¥—…·λ⁴

Output: example/internal/video/app/assets/fonts/chars.txt (dedup, sorted)
plus a sha256 digest printed for the FONTS-README.
"""
import glob
import hashlib
import io
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTDATA = os.path.join(REPO, "example", "internal", "video", "testdata")
APP = os.path.join(REPO, "example", "internal", "video", "app")
OUT_DIR = os.path.join(APP, "assets", "fonts")

chars = set()


def add(s):
    for ch in s:
        if ch in "\r\n\t":
            continue
        chars.add(ch)


# 1. IR degraded json
for p in glob.glob(os.path.join(TESTDATA, "ir", "*.degraded.json")):
    d = json.load(open(p, encoding="utf-8"))
    add(d.get("script") or "")
    for w in d.get("words") or []:
        add(w.get("text") or "")
    for el in d.get("elements") or []:
        add(el.get("text") or "")

# 2+3. Go harness string literals: quoted strings and raw strings.
go_files = [
    os.path.join(TESTDATA, "l1_render_test.go"),
    os.path.join(APP, "l0_case_library_test.go"),
]
# Capture Text:/Script:/suffix fields plus the kinsoku constants from
# subtitle.go (they cover every char the wrap logic may move to a line edge).
field_re = re.compile(r'(?:Text|Script|suffix|lineHeadForbidden|lineTailForbidden)\s*[:=]\s*("(?:[^"\\]|\\.)*"|`[^`]*`)')
for p in go_files + [os.path.join(APP, "subtitle.go")]:
    src = open(p, encoding="utf-8").read()
    for m in field_re.finditer(src):
        lit = m.group(1)
        if lit.startswith("`"):
            add(lit[1:-1])
        else:
            add(json.loads(lit))  # Go string escapes are a JSON subset for our data

# Concatenated Go constants: lineHeadForbidden is `"...") + "\"'"` — the field
# regex already caught both halves separately, but re-add the bracket forms.
for p in [os.path.join(APP, "subtitle.go")]:
    src = open(p, encoding="utf-8").read()
    for m in re.finditer(r'"([^"\n]*)"', src):
        s = m.group(1)
        # only keep strings that contain CJK or CJK punctuation (constants)
        if any("\u3000" <= c <= "\u9fff" or c in "¥—…·λ⁴" for c in s):
            add(s)

# 4. Safety margin
add("".join(chr(c) for c in range(0x20, 0x7F)))          # ASCII printable
add("".join(chr(c) for c in range(0x3000, 0x3040)))      # CJK punctuation
add("".join(chr(c) for c in range(0xFF00, 0xFFF0)))      # fullwidth forms
add("¥—…·λ⁴①②③")                                        # misc seen in content

chars.discard("\n")
chars.discard("\r")
chars.discard("\t")

ordered = sorted(chars)
text = "".join(ordered)
os.makedirs(OUT_DIR, exist_ok=True)
out_path = os.path.join(OUT_DIR, "chars.txt")
with io.open(out_path, "w", encoding="utf-8", newline="") as f:
    f.write(text)

digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
cjk = sum(1 for c in ordered if "\u3400" <= c <= "\u9fff" or "\u3400" <= c <= "\u4DBF")
print("unique chars:", len(ordered))
print("CJK chars:", cjk)
print("sha256(chars.txt):", digest)
print("written:", out_path)
