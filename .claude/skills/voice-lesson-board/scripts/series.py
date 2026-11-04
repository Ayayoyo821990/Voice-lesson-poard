# python scripts/series.py --dir lessons/img8818-try [--max 75] [--parts N]
# A long lesson → a series of Reels, cut between steps (never inside one), as balanced as possible, each part ≤ --max seconds
# when it can be. Every part becomes a lesson folder of its own (<dir>-part1, -part2 …) with its slice of the voice, its
# sentences renumbered from 1, its words, and a plan.json holding only its steps plus "series": {part, of, next}; the director
# then writes «الجزء ١ من ٣» at the start and «الجاي: …» at the end. Then direct / check / render each part as usual.
# Any subject: it only reads plan.json steps and their sentence anchors. The source lesson is not touched.
import argparse, json, os, re, shutil, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--dir', required=True); ap.add_argument('--max', type=float, default=75); ap.add_argument('--parts', type=int)
args = ap.parse_args()
def inside(p):
    a = os.path.abspath(os.path.join(ROOT, p))
    if os.path.commonpath([a, ROOT]) != ROOT: sys.exit(f'path outside the skill folder refused: {p}')
    return a
D = inside(args.dir); J = lambda f: json.load(open(os.path.join(D, f), encoding='utf8'))
plan, script, segJ, W = J('plan.json'), J('script.json'), J('segments.json'), J('words.json')
segs, words = segJ['segments'], W['words']
AN = re.compile(r'^(\d+)(?=(:|\$|$))')
TEXT = {'text', 'question', 'hero', 'hero_text', 'wrong', 'right', 'value', 'answer', 'title', 'prompt', 'head', 'word', 'meaning', 'sentence', 'gloss', 'label', 'labels', 'values', 'options', 'colors', 'from', 'to', 'note'}   # written content, never an anchor
# the sentences each step uses (anchors anywhere in it)
def refs(o, out):
    if isinstance(o, str) and AN.match(o): out.append(int(AN.match(o).group(1)))
    elif isinstance(o, dict): [refs(v, out) for k, v in o.items() if k not in TEXT]
    elif isinstance(o, list): [refs(v, out) for v in o]
first = []
for st in plan['steps']:
    r = []; refs(st, r)
    if not r: sys.exit(f'step «{st.get("title")}» has no anchors')
    first.append(min(r))
first[0] = 1                                          # part 1 starts with the recording
n, S = len(plan['steps']), len(segs)
start = lambda k: 0.0 if k == 0 else segs[first[k] - 2]['end'] + 0.05   # a part starts in the pause before its first sentence
end = lambda k: segJ['duration'] if k == n else segs[first[k] - 2]['end'] + 0.35
total = segJ['duration']; parts = args.parts or max(1, -(-int(total) // int(args.max)))
if parts > n: parts = n
# balanced cut: minimise the longest part (contiguous steps), dynamic programming over step boundaries
from functools import lru_cache
@lru_cache(None)
def best(i, p):
    if p == 1: return (end(n) - start(i), (n,))
    out = (1e9, ())
    for j in range(i + 1, n - p + 2):
        rest = best(j, p - 1); cost = max(end(j) - start(i), rest[0])
        if cost < out[0]: out = (cost, (j,) + rest[1])
    return out
cuts = [0] + list(best(0, parts)[1])
audio = next(os.path.join(D, f) for f in ('voice.mp3', 'voice.wav') if os.path.exists(os.path.join(D, f)))
base = os.path.basename(D.rstrip('\\/')); made = []
for p in range(parts):
    k0, k1 = cuts[p], cuts[p + 1]
    s0 = first[k0]; s1 = first[k1] - 1 if k1 < n else S        # sentences s0..s1
    t0, t1 = start(k0), end(k1)
    O = os.path.join(os.path.dirname(D), f'{base}-part{p + 1}'); os.makedirs(O, exist_ok=True)
    shift = s0 - 1
    def ren(o, key=None):                                # renumber anchors inside this part: "29:عايز" → "29-shift:عايز"
        if isinstance(o, str):
            m = AN.match(o)
            if m and key not in TEXT:
                v = int(m.group(1)) - shift
                if not 1 <= v <= s1 - shift: sys.exit(f'part {p + 1}: anchor "{o}" points outside its sentences {s0}–{s1}')
                return str(v) + o[m.end():]
            return o
        if isinstance(o, dict): return {k: ren(v, k) for k, v in o.items()}
        if isinstance(o, list): return [ren(v, key) for v in o]
        return o
    P = {k: v for k, v in plan.items() if k not in ('steps', 'summary', 'exempt', 'fidelity_exempt')}
    P['steps'] = [ren(st) for st in plan['steps'][k0:k1]]   # the step keeps the board splits the director found for it
    if plan.get('exempt'): P['exempt'] = {str(int(k) - shift): v for k, v in plan['exempt'].items() if s0 <= int(k) <= s1}
    if plan.get('summary') and p == parts - 1: P['summary'] = ren(plan['summary'])
    P['series'] = {'part': p + 1, 'of': parts, 'next': plan['steps'][k1]['title'] if k1 < n else None, 'first_step': k0 + 1, 'steps': n}   # steps keep their numbers in the whole lesson
    P['about'] = f'Part {p + 1} of {parts} of {args.dir} (sentences {s0}–{s1}), made by scripts/series.py. ' + plan.get('about', '')
    sw = [w for w in words]; per = [len(s['text'].split()) for s in segs]; i0 = sum(per[:s0 - 1]); i1 = sum(per[:s1])
    nseg = []
    for s in segs[s0 - 1:s1]:
        q = {**s, 'id': s['id'] - shift, 'start': round(s['start'] - t0, 3), 'end': round(s['end'] - t0, 3)}
        if 'inner_pauses' in s: q['inner_pauses'] = [[round(a - t0, 3), round(b - t0, 3)] for a, b in s['inner_pauses']]
        nseg.append(q)
    nw = [{**w, 'start': round(w['start'] - t0, 3), 'end': round(w['end'] - t0, 3)} for w in sw[i0:i1]]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t0:.3f}', '-to', f'{t1:.3f}', '-i', audio, '-c:a', 'libmp3lame', '-q:a', '2', os.path.join(O, 'voice.mp3')], check=True)
    dump = lambda f, o: json.dump(o, open(os.path.join(O, f), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    dump('plan.json', P); dump('script.json', {'about': f'Sentences {s0}–{s1} of {args.dir}', 'sentences': script['sentences'][s0 - 1:s1]})
    dump('segments.json', {**{k: v for k, v in segJ.items() if k not in ('segments', 'pauses_added')}, 'duration': round(t1 - t0, 3), 'audio': os.path.relpath(os.path.join(O, 'voice.mp3'), ROOT).replace('\\', '/'), 'segments': nseg})
    dump('words.json', {**{k: v for k, v in W.items() if k != 'words'}, 'words': nw})
    shutil.copy2(os.path.join(D, 'theme.json'), os.path.join(O, 'theme.json'))
    made.append(f'part {p + 1}: steps {k0 + 1}–{k1}, sentences {s0}–{s1}, {t1 - t0:.1f} s → {os.path.relpath(O, ROOT)}')
print(f'{args.dir}: {total:.1f} s → {parts} part(s)'); [print('  ' + m) for m in made]
