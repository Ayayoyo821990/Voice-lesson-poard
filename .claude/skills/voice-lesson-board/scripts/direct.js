// node scripts/direct.js --dir lessons/img8818 [--no-split]
// The automatic director: <dir>/plan.json (steps → beats, NO coordinates) → <dir>/lesson.json.
// Every board gets the same teaching grammar: "الخطوة ك من ن: …" on top, the hero equation in a pen frame, the work
// under it line by line, side explanations drawn by teaching patterns, fixed colours (first = blue, second = orange,
// answer = accent). A board too tall for the safe area is scaled (frame.fit) and, if that is not enough, split in two.
// Coverage: every sentence of the script must be the anchor of at least one beat, unless the plan exempts it with a reason.
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');
const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const dir = arg('dir'); if (!dir) throw new Error('usage: node scripts/direct.js --dir <lesson folder>');
const D = path.resolve(ROOT, dir); if (path.relative(ROOT, D).startsWith('..')) throw new Error(`path outside the skill folder refused: ${dir}`);
const J = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const plan = J('plan.json'), SENT = J('script.json').sentences;
const segJ = J('segments.json'), WORDS = align(segJ.segments, J('words.json').words), SEGS = segJ.segments;
const THEME = J('theme.json');
// colour meanings: first = shape (blue), second = shape2 (a second category colour) if the theme has one, answer/mistake = the ONE accent
const ROLE = { first: 'shape', second: THEME.shape2 ? 'shape2' : 'accent', answer: 'accent', mistake: 'accent', ink: 'ink', shape: 'shape', accent: 'accent' };
const role = c => c ? (ROLE[c] || (() => { throw new Error(`colour "${c}": use first, second, answer, ink`); })()) : undefined;
const clean = w => w.replace(/[،:.!؟?,]/g, '');
// any subject, any language: plan.lang "ar" (right to left, Arabic-Indic step numbers) or "en"/… (left to right)
const LANG = plan.lang || 'ar', LTR = LANG !== 'ar';
// plan.format: "portrait" (default, 1080x1920 for Reels/TikTok/Shorts) or "landscape" (1920x1080 for YouTube, a class screen)
const WIDE = ['landscape', 'youtube', 'wide'].includes(plan.format), FW = WIDE ? 1920 : 1080, FH = WIDE ? 1080 : 1920;
const XO = (FW - 1080) / 2, X = v => v + XO;   // patterns are laid out on a 1080 column; landscape centres that column
const SAFE = plan.safe || (WIDE ? { top: 40, bottom: 50, left: 110, right: 110 } : { top: 270, bottom: 480, left: 70, right: 140 }), LO = SAFE.left + 70, HI = FW - SAFE.right - 70;   // usable width for rows
const colX = (n, i) => { const w = (HI - LO) / n; return Math.round(LTR ? LO + w * (i + 0.5) : HI - w * (i + 0.5)); };   // centre of column i of n, in reading order
const SKETCH = name => { const f = path.join(ROOT, 'library', 'sketches', name + '.json'); if (!fs.existsSync(f)) throw new Error(`no drawing "${name}" in library/sketches`); return JSON.parse(fs.readFileSync(f, 'utf8')); };
const boxOf = bs => { const x0 = Math.min(...bs.map(b => b[0])), y0 = Math.min(...bs.map(b => b[1])); return { x: x0, y: y0, w: Math.max(...bs.map(b => b[2])) - x0, h: Math.max(...bs.map(b => b[3])) - y0 }; };
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

// ---- anchors: "7" (sentence 7 starts) · "7:شرطين" (that word) · "7:جذر#1" (its 2nd time in the sentence)
const used = new Set();
function A(ref) {
  if (ref === null || ref === undefined) return null;
  if (/^\d+\$$/.test(String(ref))) { const seg = parseInt(ref); if (!SENT[seg - 1]) throw new Error(`anchor "${ref}": there is no sentence ${seg}`); used.add(seg); return { segment: seg, end: true }; }   // 7$ = when sentence 7 ends
  const m = String(ref).match(/^(\d+)(?::([^#]+)(?:#(\d+))?)?$/); if (!m) throw new Error(`anchor "${ref}": write 7, 7:word, 7:word#1 or 7$ (its end)`);
  const seg = +m[1]; if (!SENT[seg - 1]) throw new Error(`anchor "${ref}": there is no sentence ${seg}`);
  used.add(seg);
  if (!m[2]) return { segment: seg };
  const idx = SENT[seg - 1].split(/\s+/).map((w, i) => [clean(w), i]).filter(([w]) => w === m[2]).map(([, i]) => i), nth = +(m[3] || 0);
  if (idx.length <= nth) throw new Error(`anchor "${ref}": «${m[2]}» ${nth ? '#' + nth + ' ' : ''}is not in sentence ${seg}: ${SENT[seg - 1]}`);
  return { segment: seg, word: m[2], index: idx[nth] };
}
const timeOf = a => { if (a.end) return SEGS[a.segment - 1].end; if (!a.word) return SEGS[a.segment - 1].start; const w = WORDS.find(w => w.seg === a.segment && w.i === a.index); return w.reliable ? w.start : w.start; };

// ---- teaching patterns: each returns events in flow order (rows); ids are made unique per board
function patterns(b, ctx) {
  const id = s => `${ctx.p}_${s}`, E = (k, text, at, o = {}) => ({ id: id(k), tool: 'expr', text, anchor: A(at), group: o.group || 'work', ...o });
  const HL = (k, of, at, o = {}) => ({ id: id(k), tool: 'highlight', label: `highlight ${of}`, of, anchor: A(at), dur: 0.5, group: 'work', opacity: 0.25, fy: 0.5, width: 62, ...o });
  const CARD = (k, of, at, o = {}) => ({ id: id(k), tool: 'card', label: `frame ${of}`, of, anchor: A(at), dur: 0.45, group: 'hero', ...o });
  const TXT = (k, text, at, o = {}) => ({ id: id(k), tool: 'text', label: text, text, anchor: A(at), dur: 0.7, size: 52, group: 'note', ...o });   // 52 > the theme minimum, so a board can still be scaled to fit
  // targets: "hero" (this board's hero), "hero:2" (its 3rd piece), "d2" (a line written in this step), "d2:2" (its piece)
  const tgt = t => { if (typeof t !== 'string') return t; const m = t.match(/^([\w]+)(?::(\d+))?$/); if (!m) return t;
    const base = m[1] === 'hero' ? ctx.hero : id(m[1]); return m[2] === undefined ? base : `${base}.${m[2]}`; };
  const col = { column: ctx.column };
  switch (b.do) {
    case 'write':                                   // one line of work, each piece on its own word
      return [E(b.id || 'w' + ctx.n, b.text, b.at, { ...col, h: b.size === 'big' ? 84 : b.size === 'small' ? 56 : 68, cues: (b.cues || []).map(A), colors: (b.colors || []).map(role), color: role(b.color), offset: b.offset })];
    case 'mark':                                    // highlight part of the hero or of an earlier line, in a meaning colour
      return [HL('m' + ctx.n, [].concat(b.of).map(tgt), b.at, { color: role(b.color) || 'accent' })];
    case 'note':
      return [TXT('n' + ctx.n, b.text, b.at, { color: role(b.color) })];
    case 'sign_flip': {                             // a term crosses "=" : its sign flips (− → +)
      const a = E('sf' + ctx.n + 'a', b.from || '-', b.at, { h: 84, x: X(660), color: 'accent', group: 'note', durs: [0.3] });
      const c = E('sf' + ctx.n + 'b', b.to || '+', b.at_to || b.at, { h: 84, x: X(420), beside: true, color: 'accent', group: 'note', durs: [0.3], offset: b.at_to ? 0 : 0.5 });
      return [a, c, { id: id('sf' + ctx.n + 'x'), tool: 'arrow', label: 'sign flips', from: { of: a.id + '.0', fx: 0, dx: -16 }, to: { of: c.id + '.0', fx: 1 }, gap: 16, anchor: A(b.at_to || b.at), offset: 0.35, dur: 0.35, group: 'note' }];
    }
    case 'tags':                                    // name two things with their colours (شرط ١ blue on the right, شرط ٢ orange on the left)
      return [{ id: id('t' + ctx.n + 'a'), tool: 'label', label: b.right, text: b.right, size: 54, cx: X(730), color: 'shape', anchor: A(b.at), dur: 0.5, group: 'note' },
              { id: id('t' + ctx.n + 'b'), tool: 'label', label: b.left, text: b.left, size: 54, cx: X(330), beside: true, color: ROLE.second, anchor: A(b.at), offset: 0.3, dur: 0.5, group: 'note' }];
    case 'rule_arrow': {                            // a rule drawn as "this → that" in a card (e.g. √□ → □ ≥ 0)
      const a = E('ra' + ctx.n + 'a', b.from, b.at, { h: 66, x: X(700), group: 'note' }), c = E('ra' + ctx.n + 'b', b.to, b.at_to || b.at, { h: 66, x: X(360), beside: true, group: 'note', offset: b.at_to ? 0 : 0.6 });
      return [a, c, { id: id('ra' + ctx.n + 'x'), tool: 'arrow', label: 'rule', from: { of: a.id + '.0', fx: 0, dx: -16 }, to: { of: c.id + '.0', fx: 1 }, gap: 16, anchor: A(b.at_to || b.at), offset: 0.3, dur: 0.35, group: 'note' },
              CARD('ra' + ctx.n + 'c', [a.id, c.id], b.at_to || b.at, { color: 'accent', pad: 18, group: 'note', offset: 0.8 })];
    }
    case 'rule':                                    // a small rule card (e.g. (√□)² = □)
      { const e = E('r' + ctx.n, b.text, b.at, { h: 54, color: role(b.color), group: 'note' }); return [e, CARD('r' + ctx.n + 'c', e.id, b.at, { color: role(b.color) || 'accent', pad: 14, group: 'note', offset: 1.0, dur: 0.35 })]; }
    case 'two_columns': {                           // pairs of lines: right = first (blue), left = second (orange); either may be null
      const out = []; b.rows.forEach(([r, l], k) => {
        if (r) out.push(E(`c${ctx.n}r${k}`, r[0], r[1], { h: 60, x: X(730), color: 'shape', group: 'cond' }));
        if (l) out.push(E(`c${ctx.n}l${k}`, l[0], l[1], { h: 60, x: X(320), beside: !!r, color: ROLE.second, group: 'cond' }));
      });
      return out;
    }
    case 'intervals': {                             // a number line, rays for each interval, and the interval written under it
      const ln = { id: id('nl' + ctx.n), tool: 'number_line', label: 'number line', w: 640, x: X(190), from: b.from ?? 0, to: b.to ?? 10, step: b.step ?? 1, major_every: b.major_every ?? 4, tick: 26,
                   headroom: 44 + 40 * b.rays.length, group: 'line', anchor: A(b.at), dur: 1.1, labels: { values: (b.labels || ['0', '4', '8']).map(String), h: 50, dur: 0.5, anchor: A(b.at), offset: 1.8 } };   // labels after the line
      ctx.lines[b.name || 'line'] = { line: ln.id, rays: b.rays.map((_, k) => id(`ray${ctx.n}_${k}`)) };
      const out = [ln];
      b.rays.forEach((r, k) => out.push({ id: id(`ray${ctx.n}_${k}`), tool: 'ray', label: `ray from ${r.from}`, line: ln.id, from: r.from, lift: 44 + 40 * k, color: role(r.color) || (k ? ROLE.second : 'shape'), group: 'line', anchor: A(r.at), dur: 0.7 }));
      const xOf = v => ln.x + ln.w * (v - ln.from) / (ln.to - ln.from);
      const xs = b.rays.map(r => Math.round(Math.min(xOf(r.from) - 16, HI - 300))), wd = r => String(r.text).length * 58 * 0.42;   // estimated width
      const order = b.rays.map((r, k) => k).filter(k => b.rays[k].text).sort((i, j) => xs[i] - xs[j]);
      const same = {}; let prev = null;               // same row; if two labels would touch, the earlier one moves left (not past the margin), else a new row
      order.forEach(k => { if (prev === null) { prev = k; return; }
        const need = xs[prev] + wd(b.rays[prev]) + 24 - xs[k];
        if (need <= 0) same[k] = true; else if (xs[prev] - need >= LO) { xs[prev] -= Math.ceil(need); same[k] = true; } else same[k] = false;
        prev = k; });
      b.rays.forEach((r, k) => { if (r.text) out.push(E(`iv${ctx.n}_${k}`, r.text, r.text_at || r.at, { h: 58, x: xs[k], align: 'left', beside: !!same[k], gap: 30, color: role(r.color) || (k ? ROLE.second : 'shape'), group: 'line', offset: r.text_at ? 0 : 0.5 })); });
      b.rays.forEach((r, k) => { if (r.mark_at) out.push(HL(`ivm${ctx.n}_${k}`, `${id(`iv${ctx.n}_${k}`)}.2`, r.mark_at, { group: 'line', width: 56 })); });
      return out;
    }
    case 'intersection': {                          // keep the overlap of two rays: highlight the chosen ray, write the result in a card
      const L0 = ctx.lines[b.of || 'line']; if (!L0) throw new Error(`intersection: no "intervals" beat named "${b.of || 'line'}" before it`);
      const ray = L0.rays[b.pick ?? 1];
      const out = [];
      if (b.note) out.push(TXT('x' + ctx.n, b.note, b.note_at || b.at, { dur: 1.2 }));
      out.push(HL('xh' + ctx.n, ray, b.at, { group: 'line', width: 40, opacity: 0.3 }));
      const r = E('xr' + ctx.n, b.result, b.result_at, { h: 80, color: 'accent', group: 'hero', gap: 30 });
      out.push(r, CARD('xc' + ctx.n, r.id, b.result_at, { offset: 0.9 }));
      return out;
    }
    case 'distribute_square':                       // (2√□)² = 2² × (√□)² and 2² = 4, drawn as two small rules
      return [E('ds' + ctx.n + 'a', '(2√(□))^2 = 2^2 × (√(□))^2', b.at, { h: 52, color: 'accent', group: 'note', durs: [0.7, 0.2, 0.4, 0.2, 0.7] }),
              E('ds' + ctx.n + 'b', `${b.k ?? 2}^2 = ${(b.k ?? 2) ** 2}`, b.at_value || b.at, { h: 52, color: 'accent', group: 'note', offset: b.at_value ? 0 : 1.5 })];
    case 'divide_both':                             // write the division on both sides as fractions (like the teacher's board), then mark the cancel
      { const e = E('db' + ctx.n, b.text, b.at, { ...col, h: 62 }); return b.cancel_at ? [e, HL('dbh' + ctx.n, `${e.id}.${b.cancel_piece ?? 2}`, b.cancel_at, { fy: 0.72, width: 44, opacity: 0.3 })] : [e]; }
    case 'check_on_line': {                         // count from the start of the interval to the answer on a number line, then a dot on it
      const ln = { id: id('cl' + ctx.n), tool: 'number_line', label: 'check line', w: 640, x: X(190), from: 0, to: 10, step: 1, major_every: 4, tick: 26, headroom: 120, group: 'line', anchor: A(b.at), dur: 1.1, labels: { values: ['0', String(b.from), String(b.value)], h: 50, dur: 0.5, anchor: A(b.at), offset: 1.8 } };
      const out = [ln, { id: id('clr' + ctx.n), tool: 'ray', label: 'interval', line: ln.id, from: b.from, lift: 40, color: 'accent', group: 'line', anchor: A(b.at_ray || b.at), offset: b.at_ray ? 0 : 0.9, dur: 0.6 }];
      (b.counts || []).forEach(([v, at]) => out.push({ id: id(`hop${ctx.n}_${v}`), tool: 'hop', label: `${v - 1} → ${v}`, line: ln.id, from: v - 1, to: v, height: 52, lift: 52, color: 'shape', group: 'line', anchor: A(at), dur: 0.35 }));
      out.push({ id: id('cld' + ctx.n), tool: 'ray', label: 'the answer', line: ln.id, from: b.value, lift: 40, dot_only: true, r: 12, color: 'accent', group: 'line', anchor: A(b.at_dot), dur: 0.4 });
      if (b.text) out.push(E('cli' + ctx.n, b.text, b.text_at || b.at_dot, { h: 66, colors: [null, null, 'accent'] }));
      return out;
    }
    case 'answer': {                                // the solution in a frame, with a small celebration
      const lab = { id: id('al' + ctx.n), tool: 'label', label: b.label, text: b.label, size: 60, cx: X(720), anchor: A(b.at), dur: 0.6, group: 'labels', gap: 36 };
      const v = E('av' + ctx.n, b.value, b.at_value || b.at, { h: 100, x: X(330), beside: true, color: 'accent', group: 'hero', offset: b.at_value ? 0 : 0.6 });
      return [lab, v, CARD('ac' + ctx.n, [lab.id, v.id], b.at_value || b.at, { offset: 1.2 }),
              { id: id('as' + ctx.n), tool: 'sparkle', label: 'sparkles', of: v.id + '.0', group: 'hero', anchor: A(b.at_spark || b.at_value || b.at), offset: b.at_spark ? 0 : 1.7, dur: 0.5 }];
    }
    case 'common_mistake': {                        // «الغلطة المشهورة»: the usual mistake is written, crossed out in the accent colour, then corrected
      const w = E('cm' + ctx.n + 'w', b.wrong, b.at, { h: 64, x: X(700), wrong_on_purpose: true, group: 'mistake' });
      const r = E('cm' + ctx.n + 'r', b.right, b.right_at, { h: 64, x: X(360), beside: true, color: 'accent', group: 'mistake' });
      return [...(b.note ? [TXT('cm' + ctx.n + 'n', b.note, b.at, { color: 'accent' })] : []), w,
              { id: id('cm' + ctx.n + 'x'), tool: 'strike', label: 'cross the mistake out', of: w.id, anchor: A(b.strike_at), dur: 0.5, group: 'mistake' }, r];
    }
    case 'try_it': {                                // «وقّف وجرّب»: a question, a ring timer (put a pause in the voice with pause.py --after), then the answer
      // kind: "answer" (default: a maths question, then the answer is said) · "choice" (options أ ب ج) · "true_false" · "blank" (fill the gap)
      const kind = b.kind || 'answer', out = [TXT('ti' + ctx.n + 't', b.prompt || (LTR ? 'Pause and try!' : 'وقّف وجرّب!'), b.at, { color: 'accent', dur: 0.5, group: 'try' })];
      const qid = 'ti' + ctx.n + 'q';
      out.push(b.question && kind === 'answer' && !b.text ? E(qid, b.question, b.at, { h: 70, group: 'try' })
        : TXT(qid, b.text || b.question, b.at, { size: 64, group: 'try', offset: 0.4, dur: 0.8 }));
      const opts = kind === 'choice' ? b.options : kind === 'true_false' ? (LTR ? ['True', 'False'] : ['صح', 'غلط']) : null;
      const right = kind === 'true_false' ? (b.answer ? 0 : 1) : b.answer;   // choice: index of the right option; true_false: answer true/false
      // choice: one option per line, like an exam paper (أ- … / a) …); true_false: the two words side by side
      if (opts) opts.forEach((o, i) => out.push({ id: id(`ti${ctx.n}o${i}`), tool: 'text', label: o, text: kind === 'choice' ? (LTR ? 'abcd'[i] + ') ' : 'أبجد'[i] + '- ') + o : o,
        size: 60, ...(kind === 'choice' ? { gap: i ? 14 : 36 } : { cx: colX(2, i), beside: i > 0, gap: 36 }), anchor: A(b.at), offset: 0.9 + i * 0.35, dur: 0.5, group: 'try', color: kind === 'true_false' ? (i ? 'accent' : 'shape') : undefined }));
      out.push({ id: id('ti' + ctx.n + 'k'), tool: 'countdown', label: 'timer', from: b.count ?? 3, r: 70, digits: LTR ? 'en' : 'ar', group: 'try', anchor: A(b.count_at || b.at), offset: b.count_at ? 0 : 1.1 + (opts ? opts.length * 0.35 : 0), dur: 0.5, gap: 30 });
      if (b.reveal_at) {                            // the right answer, said by the teacher after the pause
        if (opts) out.push(HL(`ti${ctx.n}r`, id(`ti${ctx.n}o${right}`), b.reveal_at, { group: 'try', color: 'accent', opacity: 0.3, width: 56, fy: 0.6 }),
          { id: id(`ti${ctx.n}s`), tool: 'sparkle', label: 'right answer', of: id(`ti${ctx.n}o${right}`), group: 'try', anchor: A(b.reveal_at), offset: 0.4, dur: 0.5 });
        else if (kind === 'blank') out.push(TXT(`ti${ctx.n}a`, b.answer, b.reveal_at, { size: 72, color: 'accent', group: 'try', gap: 20 }));
      }
      return out;
    }
    case 'underline':                               // a line under a word or a line of work
      return [{ id: id('u' + ctx.n), tool: 'underline', label: 'underline', of: [].concat(b.of).map(tgt), color: role(b.color) || 'accent', anchor: A(b.at), dur: 0.45, group: 'work' }];
    case 'erase':                                   // «امسح»: erase something on the board (it fades under an eraser sweep)
      return [{ id: id('e' + ctx.n), tool: 'erase', label: 'erase', of: [].concat(b.of).map(tgt), anchor: A(b.at), dur: 0.8, group: 'work' }];
    case 'greet':                                   // a greeting, big in the middle of the frame, that fades before the lesson starts
      return [{ id: id('g' + ctx.n), tool: 'text', label: 'greeting', text: b.text, size: b.size ?? 104, group: 'greeting', in_block: false, center_in_frame: true, fade_out: { at: b.hold ?? 1.2, dur: 0.3 }, anchor: A(b.at), dur: 0.6 }];
    case 'title':                                   // the lesson's or a part's title, written big
      return [TXT('ti' + ctx.n, b.text, b.at, { tool: 'title', size: b.size ?? 76, color: role(b.color), group: 'title', dur: 0.8 })];
    case 'say':                                     // one short written sentence or key word (size: big | normal | small)
      return [TXT('s' + ctx.n, b.text, b.at, { size: b.size === 'big' ? 84 : b.size === 'small' ? 50 : 60, color: role(b.color), dur: 0.7, group: b.group || 'note' })];
    case 'celebrate':                               // a pen tick and sparkles: "well done"
      { const c = { id: id('ok' + ctx.n), tool: 'check', label: 'tick', group: 'celebrate', anchor: A(b.at), dur: 0.5, gap: 40 };
        return [c, { id: id('sp' + ctx.n), tool: 'sparkle', label: 'sparkles', of: c.id, group: 'celebrate', anchor: A(b.at), offset: 0.55, dur: 0.5 }]; }
    case 'table': {                                 // a comparison table: column heads (each its own colour), then rows of cells, each cell on its own word
      const n = b.cols.length, out = [], cols = ['first', 'second', 'answer'];
      b.cols.forEach((c, i) => out.push({ id: id(`tb${ctx.n}h${i}`), tool: 'label', label: c.head, text: c.head, size: b.head_size ?? 76, cx: colX(n, i), beside: i > 0, color: role(c.color || cols[i % 3]), anchor: A(c.at), dur: 0.5, group: 'table' }));
      b.cols.forEach((c, i) => { if (c.mark_at) out.push(HL(`tb${ctx.n}m${i}`, id(`tb${ctx.n}h${i}`), c.mark_at, { group: 'table', color: role(c.color || cols[i % 3]), fy: 0.62, width: 40 })); });
      b.rows.forEach((row, r) => { let first = true; row.cells.forEach((cell, i) => { if (!cell) return; const [text, at] = Array.isArray(cell) ? cell : [cell.text, cell.at];
        out.push({ id: id(`tb${ctx.n}r${r}c${i}`), tool: 'text', label: text, text, size: row.size === 'big' ? 88 : 56, cx: colX(n, i), beside: !first, color: role(row.color), anchor: A(at), dur: 0.5, group: 'table', gap: r ? 26 : 34 }); first = false; }); });
      return out;
    }
    case 'sequence': {                              // steps in order, one under the other, joined by arrows (a process, a story, a recipe)
      const out = []; b.items.forEach(([text, at], k) => {
        out.push({ id: id(`sq${ctx.n}_${k}`), tool: 'text', label: text, text, size: b.size ?? 60, color: role(k === b.items.length - 1 && b.last_color ? b.last_color : null), anchor: A(at), offset: k ? 0.35 : 0, dur: 0.6, group: 'flow', gap: k ? 78 : 30 });
        if (k) out.push({ id: id(`sq${ctx.n}_a${k}`), tool: 'arrow', label: 'then', from: { of: id(`sq${ctx.n}_${k - 1}`), fx: 0.5, fy: 1, dy: 8 }, to: { of: id(`sq${ctx.n}_${k}`), fx: 0.5, fy: 0.5 }, gap: 10, anchor: A(at), dur: 0.35, group: 'flow', color: 'shape' }); });
      return out;
    }
    case 'cycle': {                                 // a cycle (water cycle, life cycle): items on two rows, arrows round, the last back to the first
      const n = b.items.length, m = Math.ceil(n / 2), out = [], pos = [];
      b.items.forEach(([text, at], k) => { const top = k < m, col = top ? k : m - 1 - (k - m);
        pos.push({ top, col }); out.push({ id: id(`cy${ctx.n}_${k}`), tool: 'text', label: text, text, size: b.size ?? 58, cx: colX(m, col), beside: !(top ? k === 0 : k === m), color: role(b.colors && b.colors[k]), anchor: A(at), offset: k ? 0.35 : 0, dur: 0.6, group: 'flow', gap: k === m ? 150 : 30 }); });
      const arrow = (a, c, at, k) => { const pa = pos[a], pc = pos[c], vert = pa.top !== pc.top;
        const from = vert ? { of: id(`cy${ctx.n}_${a}`), fx: 0.5, fy: pa.top ? 1 : 0, dy: pa.top ? 10 : -10 } : { of: id(`cy${ctx.n}_${a}`), fx: (pc.col > pa.col) !== LTR ? 0 : 1, fy: 0.5, dx: (pc.col > pa.col) !== LTR ? -10 : 10 };
        return { id: id(`cy${ctx.n}_a${k}`), tool: 'arrow', label: 'then', from, to: { of: id(`cy${ctx.n}_${c}`), fx: 0.5, fy: 0.5 }, gap: 12, anchor: A(at), dur: 0.4, group: 'flow', color: 'shape' }; };
      for (let k = 1; k < n; k++) out.push(arrow(k - 1, k, b.items[k][1], k));
      out.push(arrow(n - 1, 0, b.close_at || b.items[n - 1][1], n)); if (!b.close_at) out.at(-1).offset = 0.8;   // and round again
      return out;
    }
    case 'label_parts': {                           // a drawing from library/sketches, each part drawn on its word, its name beside it with an arrow
      const S = SKETCH(b.sketch), base = (b.base ?? S.base ?? []), all = [...base, ...b.parts.map(q => q.part)];
      all.forEach(k => { if (!S.parts[k]) throw new Error(`label_parts: "${b.sketch}" has no part "${k}" (it has ${Object.keys(S.parts).join(', ')})`); });
      const bx = boxOf(all.map(k => S.parts[k].box)), side = b.side || (LTR ? 'right' : 'right'), labW = b.label_room ?? 300;
      const sc = Math.min((HI - LO - labW - 40) / bx.w, (b.max_h ?? (WIDE ? 500 : 640)) / bx.h), dw = bx.w * sc;
      const g0 = WIDE ? (LO + HI - dw - labW - 40) / 2 : LO, g1 = WIDE ? (LO + HI + dw + labW + 40) / 2 : HI;   // landscape: the drawing and its names together in the middle
      const cx = side === 'right' ? g0 + dw / 2 : g1 - dw / 2;
      const pid = k => id(`lp${ctx.n}_${k}`), out = [];
      all.forEach((k, i) => { const P = S.parts[k], q = b.parts.find(q => q.part === k) || {};
        out.push({ id: pid(k), tool: 'sketch', label: k, paths: P.paths, color: role(q.color) || P.color || 'shape', ...(P.width ? { width: P.width } : {}), group: 'drawing',
          ...(i ? { frame_of: pid(all[0]) } : { box: bx, scale: +sc.toFixed(3), cx: Math.round(cx), gap: 34 }), anchor: A(q.at || b.at), dur: q.dur ?? Math.min(0.9, 0.35 + P.paths.length * 0.15) }); });   // short: its name and arrow follow while the word is still heard
      b.parts.forEach(q => { if (q.wash) out.push({ id: id(`lp${ctx.n}_w${q.part}`), tool: 'wash', label: `wash ${q.part}`, of: pid(q.part), color: role(q.wash === true ? null : q.wash), opacity: 0.32, group: 'drawing', anchor: A(q.wash_at || q.at), offset: q.wash_at ? 0 : 0.9, dur: 0.7 }); });
      b.parts.forEach(q => { if (!q.text) return; const lid = id(`lp${ctx.n}_l${q.part}`);
        out.push({ id: lid, tool: 'label', label: q.text, text: q.text, size: b.label_size ?? 60, color: role(q.label_color), near: { of: pid(q.part), side, fy: q.fy ?? 0.5, frame: all.map(pid), gap: 40 }, anchor: A(q.at), offset: 0.2, dur: 0.4, group: 'labels', appear: true },   // the name fades in: the pen draws the part and the arrow
          { id: id(`lp${ctx.n}_a${q.part}`), tool: 'arrow', label: `→ ${q.part}`, from: { of: lid, fx: side === 'right' ? 0 : 1, dx: side === 'right' ? -12 : 12, fy: 0.55 }, to: { of: pid(q.part), fx: q.fx ?? 0.5, fy: q.fy ?? 0.5 }, gap: 14, anchor: A(q.at), offset: 0.95, dur: 0.35, group: 'labels' });
        if (q.recap_at) out.push(HL(`lp${ctx.n}_r${q.part}`, lid, q.recap_at, { group: 'labels', opacity: 0.22, width: 40, fy: 0.6 })); });
      return out;
    }
    case 'word_parts': {                            // one word (or short sentence) in coloured pieces: root letters, prefix, ending, a stressed sound…
      const w = { id: id('wp' + ctx.n), tool: 'text', label: b.parts.map(q => q.text).join(''), text: b.parts.map(q => q.text).join(''), parts: b.parts.map(q => ({ text: q.text, color: role(q.color) })), size: b.size ?? 130, anchor: A(b.at), dur: 0.8, group: 'word', ...(b.dir ? { dir: b.dir } : {}) };
      const out = [w]; (b.names || []).forEach((q, k) => out.push({ id: id(`wp${ctx.n}_n${k}`), tool: 'label', label: q.text, text: q.text, size: 52, color: role(q.color), near: { of: `${w.id}.${q.of}`, side: 'below', gap: 30 }, anchor: A(q.at), dur: 0.5, group: 'word' }));
      if (b.gloss) out.push(TXT('wp' + ctx.n + 'g', b.gloss, b.gloss_at || b.at, { offset: b.gloss_at ? 0 : 0.9, gap: (b.names || []).length ? 110 : 40, group: 'word' }));
      return out;
    }
    case 'vocab': {                                 // a vocabulary card: the word, its picture (library), its meaning and an example, in one frame
      const out = [{ id: id('vw' + ctx.n), tool: 'text', label: b.word, text: b.word, dir: b.word_dir || (/[A-Za-z]/.test(b.word) ? 'ltr' : undefined), size: 110, color: 'accent', anchor: A(b.at), dur: 0.6, group: 'vocab', gap: 30 }];
      if (b.picture) { const S = SKETCH(b.picture), ks = Object.keys(S.parts), bx = boxOf(ks.map(k => S.parts[k].box)), sc = Math.min(1.6, (b.picture_h ?? 240) / bx.h);
        ks.forEach((k, i) => out.push({ id: id(`vp${ctx.n}_${k}`), tool: 'sketch', label: k, paths: S.parts[k].paths, color: S.parts[k].color || 'shape', group: 'vocab', ...(i ? { frame_of: id(`vp${ctx.n}_${ks[0]}`) } : { box: bx, scale: +sc.toFixed(3), gap: 30 }), anchor: A(b.picture_at || b.at), offset: b.picture_at ? 0 : 0.6 + i * 0.5, dur: 0.6 })); }
      if (b.meaning) out.push(TXT('vm' + ctx.n, b.meaning, b.meaning_at || b.at, { size: 56, dir: undefined, offset: b.meaning_at ? 0 : 1.2, group: 'vocab', gap: 26, _rtl: true }));
      if (b.sentence) out.push(TXT('vs' + ctx.n, b.sentence, b.sentence_at || b.at, { size: 56, dir: /[A-Za-z]/.test(b.sentence) ? 'ltr' : undefined, offset: b.sentence_at ? 0 : 1.6, group: 'vocab', gap: 26 }));
      out.push(CARD('vc' + ctx.n, out.map(e => e.id), b.card_at || b.sentence_at || b.meaning_at || b.at, { offset: 1.0, pad: 26, group: 'vocab' }));
      return out;
    }
    case 'bullets': {                               // the summary: one key point per row, each ticked when it is said
      const out = []; let same = 0; b.items.forEach(([text, at], k) => {
        same = k && at === b.items[k - 1][1] ? same + 1 : 0; const off = same * 0.9;   // points on the same anchor (e.g. "9$", after the voice) come one by one
        out.push({ id: id(`bl${ctx.n}_${k}k`), tool: 'check', label: 'tick', x: LTR ? LO + 10 : HI - 110, scale: 0.55, anchor: A(at), offset: off, dur: 0.35, group: 'summary', gap: k ? 30 : 40, color: 'accent' },
                 { id: id(`bl${ctx.n}_${k}`), tool: 'text', label: text, text, size: b.size ?? 60, cx: Math.round((LO + HI) / 2 + (LTR ? 40 : -40)), beside: true, anchor: A(at), offset: off + 0.3, dur: 0.6, group: 'summary' }); });
      return out;
    }
    case 'column':                                  // + − × in columns with carries/borrows (cues: {r0: "12:خمسة", ...})
      return [{ id: id('col' + ctx.n), tool: 'column', label: `${b.a} ${b.op} ${b.b}`, op: b.op, a: b.a, b: b.b, h: b.h ?? 130, group: 'work', anchor: A(b.at), cues: Object.fromEntries(Object.entries(b.cues || {}).map(([k, v]) => [k, A(v)])) }];
    case 'fraction_pie': {                          // a fraction shown on a pie: circle in parts, shade, the fraction beside it
      const pie = { id: id('pie' + ctx.n), tool: 'pie', label: 'pie', r: 120, x: X(720), parts: b.den, group: 'work', anchor: A(b.at), dur: 1.0 };
      return [pie, { id: id('ps' + ctx.n), tool: 'pie_shade', label: 'shade', pie: pie.id, part: 0, count: b.num, color: 'accent', group: 'work', anchor: A(b.at_shade || b.at), offset: b.at_shade ? 0 : 1.1, dur: 0.8 },
              E('pf' + ctx.n, `${b.num}/${b.den}`, b.at_fraction || b.at, { h: 100, x: X(330), beside: true, color: 'accent', offset: b.at_fraction ? 0 : 1.6 })];
    }
  }
  throw new Error(`beat "${b.do}" is not a teaching pattern (any subject: greet, title, say, celebrate, table, sequence, cycle, label_parts, word_parts, vocab, bullets, underline, erase, common_mistake, try_it, mark, note; maths: write, sign_flip, tags, rule_arrow, rule, two_columns, intervals, intersection, distribute_square, divide_both, check_on_line, answer, column, fraction_pie)`);
}

// ---- boards: one per step part; a step may be split in two when its board is too tall
function compile(steps) {
  const ev = [{ id: 'badge', tool: 'badge', label: 'subject', text: plan.subject, color: 'shape', y: SAFE.top + 62, group: 'badge', anchor: { segment: 1 }, dur: 0.9 },
              { id: 'voice', tool: 'voice_wave', label: 'voice ring', x: FW - SAFE.right - 62, y: SAFE.top + 62, size: 96, group: 'voice', anchor: { segment: 1 }, offset: 0.3, dur: 0.7 }];
  const total = new Set(steps.filter(s => !s.summary).map(s => s.n)).size, lines = {};
  used.clear();
  steps.forEach((st, k) => {
    // the board turns on the earliest sentence anything on it is anchored to (deep: rows, rays, cues, counts…)
    const refs = []; const scan = o => { if (typeof o === 'string' && /^\d+(:|\$|$)/.test(o)) refs.push(o); else if (o && typeof o === 'object') Object.values(o).forEach(scan); };   // 7, 7:word, 7$
    scan([st.hero_at, st.step_at, st.hero_cues, st.beats]);
    const firstRef = refs.reduce((a, r) => timeOf(A(r)) < timeOf(A(a)) ? r : a), first = parseInt(firstRef, 10);   // 35, 35:word or 35$
    const p = `b${k + 1}`;
    // the page turns just before the first word anything on this board is tied to — not at the start of its sentence,
    // so the end of the previous sentence keeps its time on the previous board
    if (k) {                                        // …and never before the previous sentence has finished
      if (/\$$/.test(firstRef)) ev.push({ id: `${p}_page`, tool: 'scene', label: `board ${k + 1}`, anchor: { segment: first, end: true }, offset: 0.05, fade: 0.3 });   // a board that opens on a pause turns when that sentence ends
      else {
        const prevEnd = first > 1 ? SEGS[first - 2].end : 0, turn = Math.max(timeOf(A(firstRef)) - 0.4, prevEnd + 0.05);
        ev.push({ id: `${p}_page`, tool: 'scene', label: `board ${k + 1}`, anchor: { segment: first }, offset: +(turn - SEGS[first - 1].start).toFixed(3), fade: 0.3 });
      }
    }

    if (k === 0 && plan.series) ev.push({ id: 'series', tool: 'label', label: 'part of a series', text: LTR ? `Part ${plan.series.part} of ${plan.series.of}` : `الجزء ${ARABIC_DIGITS[plan.series.part]} من ${ARABIC_DIGITS[plan.series.of]}`, size: 50, color: 'accent', anchor: A(String(first)), dur: 0.5, group: 'labels', gap: 10 });
    if (k === 0 && plan.title && !(plan.series && plan.series.part > 1)) ev.push({ id: `${p}_q`, tool: 'label', label: plan.title, text: plan.title, size: plan.title_size ?? 60, anchor: A(String(plan.title_at || first)), dur: 0.7, group: 'labels' });
    const sn = st.n + (plan.series ? plan.series.first_step - 1 : 0), tot = plan.series ? plan.series.steps : total;   // a series part keeps the step numbers of the whole lesson
    const title = st.summary ? st.title : LTR ? `Step ${sn} of ${tot}: ${st.title}${st.part > 1 ? ' (cont.)' : ''}` : `الخطوة ${ARABIC_DIGITS[sn]} من ${ARABIC_DIGITS[tot]}: ${st.title}${st.part > 1 ? ' (تابع)' : ''}`;
    const chipOn = st.summary || (plan.step_chip ?? tot > 1);
    const heroAt = st.hero_at || firstRef, hero = `${p}_hero`;   // a continuation board opens on its first anchor
    const heroEv = st.hero_text ? { id: hero, tool: 'text', label: st.hero_text, text: st.hero_text, size: 72, anchor: A(heroAt), group: 'hero', offset: k ? 0.5 : 0.2, dur: 0.7, appear: k > 0 && st.part > 1 }
      : st.hero ? { id: hero, tool: 'expr', text: st.hero, anchor: A(heroAt), group: 'hero', h: k === 0 ? 68 : st.part > 1 ? 50 : 60, offset: st.hero_cues ? 0 : (k ? 0.5 : 0.2), appear: k > 0 && !st.hero_cues,   // a recap on a new board fades in: the pen stays free for new work
      cues: (st.hero_cues || []).map(A), colors: (st.hero_colors || []).map(role), durs: st.hero_cues ? st.hero_durs : undefined } : null;
    const chip = { id: `${p}_step`, tool: 'text', label: title, text: title, size: 50, color: 'shape', anchor: A(st.step_at || heroAt), offset: 0.35, dur: 0.5, group: 'steps', appear: k > 0 };
    if (k === 0) { if (heroEv) ev.push(heroEv, { id: `${hero}Card`, tool: 'card', label: 'hero frame', of: hero, anchor: A(st.hero_card_at || heroAt), offset: st.hero_card_at ? 0 : 1.2, dur: 0.5, group: 'hero', pad: 20 }); if (chipOn) ev.push(chip); }
    else { if (chipOn) ev.push(chip); if (heroEv) ev.push(heroEv, { id: `${hero}Card`, tool: 'card', label: 'hero frame', of: hero, anchor: A(heroAt), offset: 0.7, dur: 0.4, group: 'hero', appear: true }); }   // then its frame
    st.beats.forEach((b, n) => ev.push(...patterns(b, { p, n: b._n ?? n, hero, column: `${p}_col`, lines })));   // _n: the beat's number in its step (stable when split)
  });
  if (plan.series && plan.series.next) ev.push(  // the end card, on its own short board after the voice: what the next part is about
    { id: 'next_page', tool: 'scene', label: 'end card', anchor: { segment: SENT.length, end: true }, offset: 0.15, fade: 0.3 },
    { id: 'next0', tool: 'text', label: 'next part', text: LTR ? 'Next part' : 'بالجزء الجاي', size: 58, color: 'shape', anchor: { segment: SENT.length, end: true }, offset: 0.5, dur: 0.5, group: 'labels' },
    { id: 'next', tool: 'title', label: 'next part title', text: plan.series.next, size: 84, color: 'accent', anchor: { segment: SENT.length, end: true }, offset: 0.9, dur: 0.7, group: 'labels', gap: 30 });
  return ev;
}
function splitSteps(plan) {                       // expand steps into board parts (st.split = beat index where part 2 starts)
  const out = [];
  const all = plan.summary ? [...plan.steps, { title: plan.summary.title || (LTR ? 'Summary' : 'الخلاصة'), summary: true, step_at: plan.summary.at, beats: [{ do: 'bullets', items: plan.summary.items }] }] : plan.steps;
  all.forEach((st, i) => {
    const n = i + 1, cuts = [0, ...(st.split || []), st.beats.length];
    const numbered = st.beats.map((b, i) => ({ ...b, _n: i }));
    for (let k = 0; k + 1 < cuts.length; k++) out.push({ ...st, n, part: k + 1, beats: numbered.slice(cuts[k], cuts[k + 1]), hero_cues: k ? undefined : st.hero_cues, hero_at: k ? null : st.hero_at, step_at: k ? null : st.step_at });
  });
  return out;
}
function write() {
  const steps = splitSteps(plan), events = compile(steps);
  if (LTR) events.forEach(e => { if (['text', 'label', 'title', 'badge'].includes(e.tool) && !e.dir && !e._rtl) e.dir = 'ltr'; });
  events.forEach(e => delete e._rtl);
  const lesson = { about: plan.about || `Directed by scripts/direct.js from ${dir}/plan.json`, seed: plan.seed || 1, variables: plan.variables,
    frame: { w: FW, h: FH, ...(WIDE ? { min_font: plan.min_font ?? 36 } : {}), fps: 30, tail: Math.max(0.8, (plan.summary && plan.summary.hold) || 0, plan.series && plan.series.next ? 2.5 : 0), margin: 60, center_block: true, safe: SAFE, fit: { min_scale: WIDE ? 0.7 : 0.8, max_scale: 1.35 }, auto_trim: true, pen: { max_speed: 1800, min_dur: 0.25, queue: 1.2 }, idle: { max: plan.max_idle ?? 1.5 } },
    captions: plan.captions === false ? undefined : { size: 44, dir: LTR ? 'ltr' : 'rtl', ...(plan.captions || {}) }, layout: { flow: true, gap: 26 }, coverage: { strict: true, exempt: plan.exempt || {} }, events };
  fs.writeFileSync(path.join(D, 'lesson.json'), JSON.stringify(lesson, null, 1));
  return steps;
}
// ---- build, and split a board that does not fit (up to 12 rounds)
for (let round = 0; ; round++) {
  const steps = write();
  const missing = SENT.map((_, i) => i + 1).filter(k => !used.has(k) && !(plan.exempt && plan.exempt[k]));
  if (missing.length) { console.log(`coverage FAIL: sentence(s) ${missing.join(', ')} have no beat. Add a beat for each (or exempt it with a reason).`); process.exit(1); }
  let out = '', ok = true;
  try { out = execFileSync(process.execPath, [path.join(__dirname, 'check.js'), '--dir', dir], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); ok = false; }
  const m = out.match(/BOARD_TOO_TALL board (\d+)|BOARD_TOO_TALL (b(\d+)_page)/);
  if (!ok && m && !process.argv.includes('--no-split') && round < 12) {
    const b = +(m[1] || m[3]) - 1, st = steps[b], src = plan.steps[st.n - 1], before = steps.slice(0, b).filter(s => s.n === st.n).reduce((a, s) => a + s.beats.length, 0);
    // a beat that points back at an earlier one (a mark on a line, the intersection of rays) stays on the same board
    const sticky = x => x.stick || x.do === 'intersection' || (x.do === 'mark' && [].concat(x.of).some(o => !String(o).startsWith('hero')));
    const cuts = st.beats.map((x, i) => i).filter(i => i > 0 && !sticky(st.beats[i])), half = st.beats.length / 2;
    if (!cuts.length) { console.log(out); console.log(`board ${b + 1} cannot be split (its beats belong together) and does not fit: make a beat smaller`); process.exit(1); }
    const cut = cuts.reduce((a, c) => Math.abs(c - half) < Math.abs(a - half) ? c : a);
    src.split = [...new Set([...(src.split || []), before + cut])].sort((a, c) => a - c);
    console.log(`board ${b + 1} (${st.title}) too tall → split step ${st.n} at beat ${src.split.join(', ')}`);
    continue;
  }
  console.log(out.trim());
  console.log(`\n${steps.length} boards from ${plan.steps.length} steps; ${SENT.length}/${SENT.length} sentences have a beat${plan.exempt ? ` (${Object.keys(plan.exempt).length} exempt)` : ''}; lesson.json written`);
  if (plan.steps.some(s => s.split)) fs.writeFileSync(path.join(D, 'plan.json'), JSON.stringify(plan, null, 1));   // remember the splits
  process.exit(ok ? 0 : 1);
}
