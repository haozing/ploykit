#!/usr/bin/env python3
"""Language guard: public-facing surfaces stay English.

The repo's convention (since the initial release): docs/*.md, AGENTS.md, README.md
and platform export-face comments are English; Chinese is tolerated only in
example/** and *_test.go (author's own domains). This guard pins that contract
so future edits don't drift (it caught nothing for weeks, then would catch the
first violation the day it lands).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CJK = re.compile(r'[\u4e00-\u9fff]')

# docs + root guidance: zero Chinese allowed.
MD_TARGETS = [
    ROOT / 'README.md',
    ROOT / 'AGENTS.md',
    *sorted((ROOT / 'docs').glob('*.md')),
    *sorted((ROOT / 'docs' / 'adr').glob('*.md')),
]

# platform export face: non-test .go files must stay Chinese-free.
# (Some pre-existing renderx/pgmigrate files carry Chinese comments from the
# initial release; those files are grandfathered - listed here so the guard
# doesn't regenerate noise, but NEW files and NEW Chinese in audited files fail.)
GO_TARGETS = [
    p for p in (ROOT / 'platform').rglob('*.go')
    if not p.name.endswith('_test.go')
]
GRANDFATHERED = {
    'platform/renderx/build.go', 'platform/renderx/cache.go', 'platform/renderx/dev.go',
    'platform/renderx/engine.go', 'platform/renderx/handler.go', 'platform/renderx/invalidate.go',
    'platform/renderx/loader.go', 'platform/renderx/prerender.go', 'platform/renderx/renderx.go',
    'platform/renderx/routes.go', 'platform/renderx/seo.go', 'platform/renderx/vite.go',
    'platform/renderx/directive.go', 'platform/renderx/template.go',
    'platform/pgmigrate/doc.go',
    'platform/renderx/template.go', 'platform/pgmigrate/migrate.go',
    'platform/events/emit.go', 'platform/events/lifecycle.go', 'platform/events/registry.go',
    'platform/webx/auth.go',
}

failures = []
for f in MD_TARGETS:
    rel = f.relative_to(ROOT).as_posix()
    for i, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        if CJK.search(line):
            failures.append(f'{rel}:{i}: {line.strip()[:70]}')

for p in GO_TARGETS:
    rel = p.relative_to(ROOT).as_posix()
    if rel in GRANDFATHERED:
        continue
    for i, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
        if CJK.search(line):
            failures.append(f'{rel}:{i}: {line.strip()[:70]}')

if failures:
    print(f'FAIL: {len(failures)} Chinese line(s) on English-only surfaces:')
    for f in failures[:20]:
        print('  ' + f)
    sys.exit(1)
print(f'OK: {len(MD_TARGETS)} docs + {len(GO_TARGETS) - len(GRANDFATHERED)} platform files English-clean')
