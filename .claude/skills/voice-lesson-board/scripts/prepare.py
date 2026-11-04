# python scripts/prepare.py --dir example5 [--out out/prepare-example5] [--noise -35] [--min-silence 0.25] [--sentence-gap 0.45]
# A real recording (+ its script, if there is one) → segments.json and words.json, with no hand work.
#   <dir>/voice.mp3 or voice.wav
#   <dir>/script.json   { "sentences": ["...", ...] }   optional. Without it the recording is transcribed, cut into sentences at
#                       pauses >= --sentence-gap s (or . ؟ ! from the recogniser), and script.json is written with "auto": true
#                       so the teacher can correct words; running prepare.py again then re-times against the corrected text.
# 1. ffmpeg silencedetect finds the pauses (all times come from here or from the recognizer, none are invented)
# 2. faster-whisper (local model only, never downloaded) gives word timings, prompted with the script
# 3. script words are matched to heard words (edit-distance alignment on normalised Arabic); the pause that sits
#    between the last word of a sentence and the first word of the next becomes the sentence boundary
# Writes into <dir> unless --out is given; prints a short report of anything uncertain.
import argparse, json, os, re, subprocess, sys, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument('--dir', required=True); ap.add_argument('--out')
ap.add_argument('--noise', type=float, default=-35); ap.add_argument('--min-silence', type=float, default=0.25)
ap.add_argument('--model', default='large-v3'); ap.add_argument('--sentence-gap', type=float, default=0.45)
ap.add_argument('--language', default='ar', help='language of the recording for the recogniser (ar, en, ...)')
args = ap.parse_args()

def inside(p):
    a = os.path.abspath(os.path.join(ROOT, p))
    if os.path.commonpath([a, ROOT]) != ROOT: sys.exit(f'path outside the skill folder refused: {p}')
    return a
D = inside(args.dir); OUT = inside(args.out) if args.out else D
os.makedirs(OUT, exist_ok=True)
script_path = os.path.join(D, 'script.json')
script = json.load(open(script_path, encoding='utf8'))['sentences'] if os.path.exists(script_path) else None
audio = next((os.path.join(D, f) for f in ('voice.mp3', 'voice.wav') if os.path.exists(os.path.join(D, f))), None)
if not audio: sys.exit(f'no voice.mp3 or voice.wav in {args.dir}')
rel_audio = os.path.relpath(audio, ROOT).replace('\\', '/')

# ---- 1. pauses
err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', audio, '-af', f'silencedetect=noise={args.noise}dB:d={args.min_silence}', '-f', 'null', '-'],
                     capture_output=True, text=True, encoding='utf8', errors='replace').stderr
hh, mm, ss = re.search(r'Duration: (\d+):(\d+):([\d.]+)', err).groups()
duration = 3600 * int(hh) + 60 * int(mm) + float(ss)
starts = [float(x) for x in re.findall(r'silence_start: (-?[\d.]+)', err)]
ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
sil = [(max(0.0, a), ends[i] if i < len(ends) else duration) for i, a in enumerate(starts)]

# ---- 2. recogniser (local cache only)
from faster_whisper import WhisperModel
model = WhisperModel(args.model, device='cpu', compute_type='int8', local_files_only=True)
import numpy as np                                   # decode with ffmpeg (faster-whisper's own loader depends on the PyAV version)
pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout
segs, _ = model.transcribe(np.frombuffer(pcm, np.int16).astype(np.float32) / 32768, language=args.language, word_timestamps=True, beam_size=5, initial_prompt=' '.join(script) if script else None, vad_filter=False)
heard = [{'word': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3), 'p': round(w.probability, 3)} for s in segs for w in s.words if w.word.strip()]

# ---- 2a. recogniser check: a loop (the same 1-4 words three times or more in a row) means whisper got stuck;
#          transcribe again with voice-activity cuts and without carrying the previous text, and say so
def loops(ws):
    t = [w['word'] for w in ws]; found = []
    for n in (1, 2, 3, 4):
        i = 0
        while i + 3 * n <= len(t):
            k = 1
            while i + (k + 1) * n <= len(t) and t[i + k * n:i + (k + 1) * n] == t[i:i + n]: k += 1
            if k >= 3: found.append((ws[i]['start'], ' '.join(t[i:i + n]), k)); i += k * n
            else: i += 1
    return found
def faults(ws):                                      # loops, stray foreign words, and runs of very unsure words
    out = [f'«{g}» ×{k} at {t:.1f} s' for t, g, k in loops(ws)]
    if args.language == 'ar':
        out += [f'foreign word «{w["word"]}» at {w["start"]:.1f} s' for w in ws if re.fullmatch(r"[A-Za-z]{3,}[.,?!]?", w['word'])]
    for i in range(0, max(0, len(ws) - 10), 5):
        win = ws[i:i + 10]
        if sum(w['p'] for w in win) / len(win) < 0.45: out.append(f'unsure stretch at {win[0]["start"]:.1f}–{win[-1]["end"]:.1f} s')
    return out
bad = faults(heard)
if bad:
    print('recogniser faults: ' + '; '.join(bad[:6]) + (' …' if len(bad) > 6 else '') + ' → transcribing again carefully')
    segs, _ = model.transcribe(np.frombuffer(pcm, np.int16).astype(np.float32) / 32768, language=args.language, word_timestamps=True, beam_size=5,
                               initial_prompt=' '.join(script) if script else None, vad_filter=True, vad_parameters={'min_silence_duration_ms': 300},
                               condition_on_previous_text=False, temperature=[0.0, 0.2, 0.4])
    heard = [{'word': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3), 'p': round(w.probability, 3)} for s in segs for w in s.words if w.word.strip()]
    left = faults(heard)
    print('  after the careful pass: ' + ('clean' if not left else 'still: ' + '; '.join(left[:6]) + ' — check these words by ear'))

# ---- 2b. no script: the transcript becomes the script, cut at long pauses or sentence punctuation
if script is None:
    script, cur = [], []
    for q, h in enumerate(heard):
        cur.append(h['word'])
        nxt = heard[q + 1] if q + 1 < len(heard) else None
        mid = lambda w: (w['start'] + w['end']) / 2          # the recogniser often stretches a word over the pause next to it
        gap = nxt and any(b - a >= args.sentence_gap and mid(h) < (a + b) / 2 < mid(nxt) for a, b in sil)
        if not nxt or gap or re.search(r'[.!?؟]$', h['word']): script.append(' '.join(cur)); cur = []
    json.dump({'auto': True, 'review': 'Written by scripts/prepare.py from the recording. Check every word (numbers too), fix what was misheard, keep one entry per sentence, delete "auto", then run prepare.py again.',
               'sentences': script}, open(script_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'no script.json: transcribed {len(heard)} words into {len(script)} sentences → {os.path.relpath(script_path, ROOT)} (please review)')

# ---- 3. match script words to heard words
PUNCT = '،:.!؟?,;"'
def norm(t):
    t = ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c))
    t = re.sub('[إأآٱ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ـ', '')
    return ''.join(c for c in t if c not in PUNCT).lower()
sw = [(k, w) for k, s in enumerate(script) for w in s.split()]
A, B = [norm(w) for _, w in sw], [norm(h['word']) for h in heard]
sim = lambda a, b: SequenceMatcher(None, a, b).ratio()
n, m = len(A), len(B)
cost = [[0.0] * (m + 1) for _ in range(n + 1)]; back = [[None] * (m + 1) for _ in range(n + 1)]
for i in range(1, n + 1): cost[i][0], back[i][0] = i, 'del'
for j in range(1, m + 1): cost[0][j], back[0][j] = j * 0.8, 'ins'
for i in range(1, n + 1):
    for j in range(1, m + 1):
        opts = [(cost[i-1][j-1] + (1 - sim(A[i-1], B[j-1])) * 1.6, 'sub'), (cost[i-1][j] + 1, 'del'), (cost[i][j-1] + 0.8, 'ins')]
        cost[i][j], back[i][j] = min(opts)
match = [[] for _ in range(n)]; i, j = n, m; pending = []
while i or j:
    op = back[i][j]
    if op == 'sub': match[i-1] = [j-1] + pending; pending = []; i -= 1; j -= 1
    elif op == 'del': i -= 1
    else: pending.append(j-1); j -= 1                 # extra heard word: glued to the script word before it
words, notes = [], []
for idx, ((k, w), hs) in enumerate(zip(sw, match)):
    if hs:
        hs = sorted(hs); st, en = heard[hs[0]]['start'], heard[hs[-1]]['end']
        conf = min(heard[h]['p'] for h in hs) * (1 if sim(A[idx], norm(''.join(heard[h]['word'] for h in hs))) > 0.5 else 0.5)
        words.append({'word': w.strip(PUNCT), 'heard': ' '.join(heard[h]['word'] for h in hs), 'start': st, 'end': en, 'confidence': round(conf, 3), 'sentence': k + 1})
    else:
        words.append({'word': w.strip(PUNCT), 'heard': '', 'start': None, 'end': None, 'confidence': 0.0, 'sentence': k + 1})
for q, wd in enumerate(words):                        # script words nobody heard: squeezed between their neighbours
    if wd['start'] is None:
        prev = next((words[r]['end'] for r in range(q - 1, -1, -1) if words[r]['start'] is not None), 0.0)
        nxt = next((words[r]['start'] for r in range(q + 1, len(words)) if words[r]['start'] is not None), duration)
        wd['start'], wd['end'] = round(prev, 3), round(max(prev + 0.05, min(nxt, prev + 0.3)), 3)
        notes.append(f'«{wd["word"]}» (sentence {wd["sentence"]}) was not heard: timing guessed, it will use its fallback_offset')

# ---- 4. sentence boundaries = the longest detected pause between two sentences
segments, bounds = [], []
for k in range(len(script) - 1):
    last = [w for w in words if w['sentence'] == k + 1][-1]; first = [w for w in words if w['sentence'] == k + 2][0]
    lo, hi = min(last['start'], last['end'] - 0.05), max(first['end'], first['start'] + 0.05)
    floor = bounds[-1][1] if bounds else 0.0                # each boundary takes its own pause, after the previous one
    # prefer pauses between the middles of the two words (the recogniser stretches words over the pause beside them)
    mid = lambda w: (w['start'] + w['end']) / 2
    cand = [s for s in sil if mid(last) < (s[0] + s[1]) / 2 < mid(first) and s[0] >= floor] or            [s for s in sil if s[1] > lo and s[0] < hi and s[0] >= floor]
    if cand: bounds.append(max(cand, key=lambda s: s[1] - s[0]))
    else:
        mid = round(max((last['end'] + first['start']) / 2, floor), 3); bounds.append((mid, mid))
        notes.append(f'no pause found between sentence {k + 1} and {k + 2}: boundary put at {mid} s')
lead = sil[0][1] if sil and sil[0][0] <= 0.01 else 0.0
tail = sil[-1][0] if sil and sil[-1][1] >= duration - 0.01 else duration
for k, text in enumerate(script):
    st = lead if k == 0 else bounds[k - 1][1]; en = bounds[k][0] if k < len(bounds) else tail
    seg = {'id': k + 1, 'text': text, 'start': round(st, 3), 'end': round(en, 3)}
    inner = [[round(a, 3), round(b, 3)] for a, b in sil if a > st + 0.01 and b < en - 0.01]
    if inner: seg['inner_pauses'] = inner
    segments.append(seg)
for s in segments:                                     # every word must end inside its own sentence for align.js
    for w in words:
        if w['sentence'] == s['id']:                   # a word starts no earlier than its own sentence (the recogniser often starts it in the pause before)
            w['end'] = round(min(max(w['end'], s['start'] + 0.05), s['end'] + 0.25), 3); w['start'] = round(min(max(w['start'], s['start']), w['end'] - 0.05), 3)

def in_order(ws, seg):
    clear = [i for i, w in enumerate(ws) if w['confidence'] >= 0.8]
    for i, w in enumerate(ws):
        if i and w['start'] < ws[i - 1]['start'] + 0.05 or (w['confidence'] < 0.8 and any(w['start'] < ws[j]['start'] for j in clear if j < i)):
            nxt = next((ws[j]['start'] for j in range(i + 1, len(ws)) if ws[j]['start'] > ws[i - 1]['start'] + 0.1), seg['end']) if i else seg['start']
            lo = ws[i - 1]['start'] + 0.05 if i else seg['start']
            w['start'] = round(lo + max(0.05, (nxt - lo) / 2) if nxt > lo + 0.1 else lo, 3); w['end'] = round(max(w['end'], w['start'] + 0.05), 3)
            w['reordered'] = True
def spread(ws, seg):                                   # a run of unclear words shares the time between its clear neighbours, by length
    i = 0
    while i < len(ws):
        if ws[i]['confidence'] >= 0.8: i += 1; continue
        j = i
        while j < len(ws) and ws[j]['confidence'] < 0.8: j += 1
        lo = ws[i - 1]['end'] if i else seg['start']; hi = ws[j]['start'] if j < len(ws) else seg['end']
        if hi - lo > 0.1 * (j - i):
            size = [max(2, len(re.sub(r'[ً-ْ،:.!؟?,]', '', w['word']))) for w in ws[i:j]]; t = lo
            for w, n in zip(ws[i:j], size):
                d = (hi - lo) * n / sum(size); w['start'] = round(t, 3); w['end'] = round(t + d * 0.9, 3); w['spread'] = True; t += d
        i = j
for s in segments:
    ws = [w for w in words if w['sentence'] == s['id']]; in_order(ws, s); spread(ws, s)
json.dump({'audio': rel_audio, 'duration': round(duration, 3),
           'method': f'scripts/prepare.py: ffmpeg silencedetect noise={args.noise}dB d={args.min_silence}; sentence boundary = longest detected pause between the last word of a sentence and the first of the next (word times: faster-whisper {args.model}, local).',
           'segments': segments}, open(os.path.join(OUT, 'segments.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
json.dump({'best_effort': True, 'model': f'faster-whisper {args.model} (local cache, int8 cpu), matched to script.json by scripts/prepare.py',
           'words': [{k: w[k] for k in ('word', 'heard', 'start', 'end', 'confidence')} for w in words]},
          open(os.path.join(OUT, 'words.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
low = [w for w in words if w['confidence'] < 0.8]
print(f'{len(segments)} sentences, {len(words)} words, {len(heard)} heard, {duration:.2f} s → {os.path.relpath(OUT, ROOT)}')
print(f'low-confidence words (will use fallback_offset): {len(low)}' + (': ' + ', '.join(w["word"] for w in low[:12]) if low else ''))
for s in segments: print(f' seg {s["id"]} {s["start"]:.3f}-{s["end"]:.3f}  {s["text"]}')
for x in notes: print(' NOTE ' + x)
