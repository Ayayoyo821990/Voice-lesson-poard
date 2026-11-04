# python scripts/refine.py --dir lessons/img8818-try [--language ar] [--model large-v3]
# Second, script-guided timing pass for ANY subject or language. prepare.py hears the whole recording at once; words it was
# unsure of get spread or guessed times (the board then draws on an estimate). Here every sentence is heard ON ITS OWN, with
# its own known text as the recogniser's prompt, so each unsure word is located again inside its sentence.
# A new time is kept only when the heard word matches the script word and the times stay in spoken order inside the sentence.
# Only words.json changes (the old one is kept as words.json.before-refine); segments.json is never touched.
import argparse, json, os, re, shutil, subprocess, sys, unicodedata
from difflib import SequenceMatcher
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--dir', required=True)
ap.add_argument('--language', default='ar'); ap.add_argument('--model', default='large-v3')
ap.add_argument('--min-sim', type=float, default=0.7, help='how close the heard word must be to the script word')
args = ap.parse_args()
def inside(p):
    a = os.path.abspath(os.path.join(ROOT, p))
    if os.path.commonpath([a, ROOT]) != ROOT: sys.exit(f'path outside the skill folder refused: {p}')
    return a
D = inside(args.dir)
segJ = json.load(open(os.path.join(D, 'segments.json'), encoding='utf8')); W = json.load(open(os.path.join(D, 'words.json'), encoding='utf8'))
segs, words = segJ['segments'], W['words']
per = [s['text'].split() for s in segs]
if sum(map(len, per)) != len(words): sys.exit(f'words.json has {len(words)} words but the sentences have {sum(map(len, per))}: run prepare.py first')
audio = next(os.path.join(D, f) for f in ('voice.mp3', 'voice.wav') if os.path.exists(os.path.join(D, f)))
import numpy as np
from faster_whisper import WhisperModel
model = WhisperModel(args.model, device='cpu', compute_type='int8', local_files_only=True)
SR = 16000
pcm = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout, np.int16).astype(np.float32) / 32768

PUNCT = '،:.!؟?,;"«»'
def norm(t):
    t = ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c))
    t = re.sub('[إأآٱ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ـ', '')
    return ''.join(c for c in t if c not in PUNCT).lower()
sim = lambda a, b: SequenceMatcher(None, a, b).ratio()
def match(A, B):                                     # edit-distance alignment script words ↔ heard words (as prepare.py)
    n, m = len(A), len(B); cost = [[0.0] * (m + 1) for _ in range(n + 1)]; back = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): cost[i][0], back[i][0] = i, 'del'
    for j in range(1, m + 1): cost[0][j], back[0][j] = j * 0.8, 'ins'
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost[i][j], back[i][j] = min((cost[i-1][j-1] + (1 - sim(A[i-1], B[j-1])) * 1.6, 'sub'), (cost[i-1][j] + 1, 'del'), (cost[i][j-1] + 0.8, 'ins'))
    out = [None] * n; i, j = n, m
    while i or j:
        op = back[i][j]
        if op == 'sub': out[i-1] = j-1; i -= 1; j -= 1
        elif op == 'del': i -= 1
        else: j -= 1
    return out

k0, before, fixed, kept = 0, 0, 0, 0
for s, sw in zip(segs, per):
    ws = words[k0:k0 + len(sw)]; k0 += len(sw)
    unsure = [i for i, w in enumerate(ws) if w['confidence'] < 0.8 or (w['end'] - w['start']) < 0.1]
    before += len(unsure)
    if not unsure: continue
    a, b = max(0.0, s['start'] - 0.15), s['end'] + 0.15
    got, _ = model.transcribe(pcm[int(a * SR):int(b * SR)], language=args.language, word_timestamps=True, beam_size=5,
                              initial_prompt=s['text'], condition_on_previous_text=False, vad_filter=False)
    heard = [{'w': x.word.strip(), 's': a + x.start, 'e': a + x.end, 'p': x.probability} for g in got for x in g.words if x.word.strip()]
    m = match([norm(x) for x in sw], [norm(h['w']) for h in heard])
    for i in unsure:
        j = m[i]
        if j is None: continue
        h = heard[j]; q = sim(norm(sw[i]), norm(h['w']))
        if q < args.min_sim or h['e'] - h['s'] < 0.06: continue
        st, en = max(h['s'], s['start']), min(h['e'], s['end'] + 0.25)
        prev = next((ws[r]['start'] for r in range(i - 1, -1, -1)), s['start'] - 1)
        nxt = next((ws[r]['start'] for r in range(i + 1, len(ws)) if r not in unsure), s['end'] + 1)
        if not (prev + 0.03 <= st < nxt - 0.03) or en <= st: kept += 1; continue   # would break spoken order: keep the old time
        w = ws[i]; w['start'], w['end'] = round(st, 3), round(max(en, st + 0.1), 3)
        w['confidence'] = round(max(w['confidence'], min(q, 0.5 + h['p'])), 3)   # timing confidence: the known word was found where it was said
        w['heard'] = h['w']; w['refined'] = True; fixed += 1
    print(f' seg {s["id"]}: {sum(1 for i in unsure if ws[i].get("refined"))}/{len(unsure)} unsure word(s) located')
bk = os.path.join(D, 'words.json.before-refine')
if not os.path.exists(bk): shutil.copy2(os.path.join(D, 'words.json'), bk)
W['refined'] = f'scripts/refine.py: each sentence heard alone with its own text as prompt (faster-whisper {args.model}, local)'
json.dump(W, open(os.path.join(D, 'words.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
left = sum(1 for w in words if w['confidence'] < 0.8 or w['end'] - w['start'] < 0.1)
print(f'{os.path.relpath(D, ROOT)}: unsure words {before} → {left} ({fixed} located again, {kept} kept because the new time broke the spoken order)')
