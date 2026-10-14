#!/usr/bin/env python3
"""License audit helper: compares this repo's source with a checkout of another project (e.g. chatboxai/chatbox, GPL-3.0).
Reports (1) identical normalized lines >= 40 chars, (2) identical 3-line windows, (3) byte-identical image assets.
Usage: git clone --depth 1 https://github.com/chatboxai/chatbox.git /tmp/ref && python3 scripts/similarity-audit.py /tmp/ref"""
import os, re, sys, subprocess, hashlib, collections
ref = sys.argv[1]
ls = lambda root: [f for f in subprocess.check_output(['git', 'ls-files'], cwd=root, text=True).split('\n') if f]
code = re.compile(r'\.(ts|tsx|js|jsx|mjs|css|scss|html)$')
ours = [f for f in ls('.') if code.search(f)]
theirs = [os.path.join(ref, f) for f in ls(ref) if code.search(f)]
norm = lambda l: re.sub(r'\s+', '', l)
def read(f):
    try: return open(f, errors='ignore').read().split('\n')
    except Exception: return []
idx = collections.defaultdict(set)
for f in theirs:
    for l in read(f):
        n = norm(l)
        if len(n) >= 40: idx[n].add(f)
total, hits = 0, []
for f in ours:
    for i, l in enumerate(read(f), 1):
        n = norm(l)
        if len(n) >= 40:
            total += 1
            if n in idx: hits.append((f, i, l.strip()[:100]))
print(f'lines >= 40 chars: {total}; identical to reference: {len(hits)}')
for h in hits: print('  ', *h)
def windows(fs, k=3):
    d = {}
    for f in fs:
        L = [x for x in map(norm, read(f)) if len(x) >= 15]
        for j in range(len(L) - k + 1): d.setdefault('|'.join(L[j:j + k]), f)
    return d
tw, ow = windows(theirs), windows(ours)
common = [(ow[k], k[:100]) for k in ow if k in tw]
print(f'identical 3-line windows: {len(common)}')
for c in common: print('  ', *c)
img = re.compile(r'\.(png|ico|icns|svg|jpg|jpeg|gif)$')
th = {hashlib.sha256(open(os.path.join(ref, f), 'rb').read()).hexdigest() for f in ls(ref) if img.search(f)}
same = [f for f in ls('.') + ['build/icon.ico'] if img.search(f) and os.path.exists(f) and hashlib.sha256(open(f, 'rb').read()).hexdigest() in th]
print(f'byte-identical image assets: {same}')
