# python scripts/fidelity.py --dir lessons/img8818 [--transcript source/transcript-careful.json]
# Faithfulness check: nothing the teacher explained may be lost between his recording and the final script.
# Compares the teacher's own transcript (what he really said) with <dir>/script.json (what will be voiced and drawn):
#   - every transcript passage gets a coverage % (its meaningful words found in the script, numbers said as digits or words)
#   - a passage under 60 % is reported; if it carries a reason ("عشان", "لازم", "المفروض", "طبعاً", "لما"…) the check FAILS
# Writes out/fidelity-<dir>.md and prints a short summary.
import argparse, json, os, re, sys, unicodedata
from difflib import SequenceMatcher
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument('--dir', required=True); ap.add_argument('--transcript', default='source/transcript-careful.json')
args = ap.parse_args()
D = os.path.abspath(os.path.join(ROOT, args.dir))
if os.path.commonpath([D, ROOT]) != ROOT: sys.exit(f'path outside the skill folder refused: {args.dir}')
tr = json.load(open(os.path.join(D, args.transcript), encoding='utf8'))
passages = [p['text'] for p in tr] if isinstance(tr, list) else tr['sentences']
script = json.load(open(os.path.join(D, 'script.json'), encoding='utf8'))['sentences']

NUM = {'0': 'صفر', '1': 'واحد', '2': 'اتنين', '3': 'تلاته', '4': 'اربعه', '5': 'خمسه', '6': 'سته', '7': 'سبعه', '8': 'تمانيه', '9': 'تسعه', '16': 'ستاشر', 'x': 'اكس'}
FILLER = set('يا شباب ايه طب طيب ها كده ده دي دول اه برضو برضه هنا مين كم كام اهو و في من على الى انا احنا انت هو هي ما'.split())
REASON = re.compile(r'عشان|علشان|لان|لأن|المفروض|لازم|يجب|طبعا|طبعاً|دايما|دايماً|مدام|ما دام|لما|يبقى|بحيث')
def norm(t):
    t = ''.join(c for c in unicodedata.normalize('NFKD', t) if not unicodedata.combining(c))
    t = re.sub('[إأآٱ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ث', 'ت').replace('ذ', 'ز').replace('ـ', '')
    t = re.sub(r'(\d+)\s*x', lambda m: f' {m.group(1)} x ', t.lower())
    out = []
    for w in re.findall(r'[؀-ۿa-z0-9]+', t):
        w = re.sub(r'^(و|ف|ب|ل|ال|ه|ح)(?=...)', '', w) if len(w) > 3 else w   # drop و ف ب ل ال and the Egyptian/Levantine future هـ حـ
        w = NUM.get(w, w)
        if w not in FILLER and len(w) > 1: out.append(w)
    return out
pool = [w for s in script for w in norm(s)]
def found(w): return w in pool or any(SequenceMatcher(None, w, p).ratio() >= 0.8 for p in pool)
rows, bad = [], []
for k, p in enumerate(passages, 1):
    ws = norm(p)
    cov = sum(found(w) for w in ws) / len(ws) if ws else 1.0
    reason = bool(REASON.search(p))
    rows.append((k, cov, reason, p))
    if cov < 0.6: bad.append((k, cov, reason, p))
plan_p = os.path.join(D, 'plan.json')                # a passage may be exempted in plan.json, always with a written reason
EX = json.load(open(plan_p, encoding='utf8')).get('fidelity_exempt', {}) if os.path.exists(plan_p) else {}
bad = [b for b in bad if str(b[0]) not in EX]
lost = [b for b in bad if b[2]]
md = [f'# fidelity — {args.dir}', '', f'{len(passages)} passages of the teacher\'s recording vs {len(script)} script sentences.',
      f'**{"FAIL" if lost else "PASS"}**: {len(bad)} passage(s) under 60 % coverage, {len(lost)} of them carry a reason.', '',
      '| # | coverage | reason? | what the teacher said |', '|---|---|---|---|']
md += [f'| {k} | {cov:.0%} | {"yes" if r else ""} | {p}{" — *exempt: " + EX[str(k)] + "*" if str(k) in EX else ""} |' for k, cov, r, p in rows]
os.makedirs(os.path.join(ROOT, 'out'), exist_ok=True)
out = os.path.join(ROOT, 'out', 'fidelity-' + re.sub(r'[\\/]', '-', args.dir) + '.md')
open(out, 'w', encoding='utf8').write('\n'.join(md) + '\n')
print(f'fidelity {"FAIL" if lost else "PASS"}: {len(passages)} passages, mean coverage {sum(r[1] for r in rows) / len(rows):.0%}, {len(bad)} under 60 %, {len(lost)} with a reason → {os.path.relpath(out, ROOT)}')
for k, cov, r, p in bad: print(f'  {"LOST REASON" if r else "low"} #{k} ({cov:.0%}): {p}')
sys.exit(1 if lost else 0)
