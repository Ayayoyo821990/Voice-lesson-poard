# python scripts/pause.py --dir lessons/img8818 --out lessons/img8818-try --after 35 3
# python scripts/pause.py --dir lessons/img8818 --out lessons/img8818-slow --slow 0.6 1.6
# Silence inserted into a lesson's voice, and every time after it shifted (segments.json, words.json) — no re-transcription.
#   --after N S      S seconds of silence when sentence N ends (room for «وقّف وجرّب»: a question and a 3-2-1 countdown)
#   --slow A B       the slow version: A s after every sentence, B s after the last sentence of every step of plan.json
# The new folder gets copies of every lesson file; the original lesson is not touched.
import argparse, json, os, shutil, subprocess, sys
import numpy as np
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--dir', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--after', nargs=2, type=float, action='append', metavar=('SENTENCE', 'SECONDS'), default=[])
ap.add_argument('--slow', nargs=2, type=float, metavar=('EACH', 'STEP'))
args = ap.parse_args()
def inside(p):
    a = os.path.abspath(os.path.join(ROOT, p))
    if os.path.commonpath([a, ROOT]) != ROOT: sys.exit(f'path outside the skill folder refused: {p}')
    return a
D, O = inside(args.dir), inside(args.out)
if D == O: sys.exit('--out must be a new folder: the original lesson is kept as it is')
os.makedirs(O, exist_ok=True)
for f in os.listdir(D):
    if os.path.isfile(os.path.join(D, f)): shutil.copy2(os.path.join(D, f), os.path.join(O, f))
segJ = json.load(open(os.path.join(D, 'segments.json'), encoding='utf8')); words = json.load(open(os.path.join(D, 'words.json'), encoding='utf8'))
segs = segJ['segments']
# where to insert: {sentence id: seconds}
add = {}
for n, sec in args.after: add[int(n)] = add.get(int(n), 0) + sec
if args.slow:
    each, step = args.slow
    for s in segs[:-1]: add[s['id']] = add.get(s['id'], 0) + each
    plan_p = os.path.join(D, 'plan.json')
    if os.path.exists(plan_p):
        import re
        P = json.load(open(plan_p, encoding='utf8'))
        for st in P['steps']:
            refs = []
            def scan(o):
                if isinstance(o, str) and re.match(r'^\d+(:|\$|$)', o): refs.append(int(re.match(r'^\d+', o).group()))
                elif isinstance(o, dict): [scan(v) for v in o.values()]
                elif isinstance(o, list): [scan(v) for v in o]
            scan(st)
            if refs and max(refs) < segs[-1]['id']: add[max(refs)] = add.get(max(refs), 0) + step
# cut points (seconds in the original audio): right after each sentence's end
cuts = sorted((segs[n - 1]['end'] + 0.02, sec) for n, sec in add.items())
audio = next(os.path.join(D, f) for f in ('voice.mp3', 'voice.wav') if os.path.exists(os.path.join(D, f)))
SR = 44100
pcm = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout, np.int16)
parts, last = [], 0
for t, sec in cuts:
    i = min(len(pcm), int(round(t * SR))); parts += [pcm[last:i], np.zeros(int(round(sec * SR)), np.int16)]; last = i
parts.append(pcm[last:])
out_pcm = np.concatenate(parts).tobytes()
for f in ('voice.mp3', 'voice.wav'):
    if os.path.exists(os.path.join(O, f)): os.replace(os.path.join(O, f), os.path.join(O, f + '.before-pause'))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ac', '1', '-ar', str(SR), '-i', '-', '-c:a', 'libmp3lame', '-q:a', '2', os.path.join(O, 'voice.mp3')], input=out_pcm, check=True)
shift = lambda x: x + sum(sec for t, sec in cuts if t <= x)
for s in segs:
    s['start'], s['end'] = round(shift(s['start']), 3), round(shift(s['end']), 3)
    if 'inner_pauses' in s: s['inner_pauses'] = [[round(shift(a), 3), round(shift(b), 3)] for a, b in s['inner_pauses']]
for w in words['words']:                             # a word moves with its START, so it stays in its own sentence
    d = shift(w['start']) - w['start']; w['start'], w['end'] = round(w['start'] + d, 3), round(w['end'] + d, 3)
total = sum(add.values()); segJ['duration'] = round(segJ['duration'] + total, 3); segJ['audio'] = os.path.relpath(os.path.join(O, 'voice.mp3'), ROOT).replace('\\', '/')
segJ['pauses_added'] = [{'after_sentence': n, 'seconds': sec} for n, sec in sorted(add.items())]
json.dump(segJ, open(os.path.join(O, 'segments.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
json.dump(words, open(os.path.join(O, 'words.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'{os.path.relpath(O, ROOT)}: {len(add)} pause(s), +{total:.1f} s → {segJ["duration"]:.1f} s ({", ".join(f"after {n}: {sec:g} s" for n, sec in sorted(add.items())[:6])}{" …" if len(add) > 6 else ""})')
