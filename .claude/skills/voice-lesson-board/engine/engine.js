// voice-lesson-board engine: draws a lesson.json on a paper board, timed by spoken words.
// Inputs (injected by scripts/render.js): window.LESSON, THEME, SEGMENTS, WORDS (aligned), ROOT (skill folder URL).
// seek(t) is a pure function of t: no timers, no transitions, no Math.random (seeded PRNG only).
'use strict';
Math.random = () => { throw new Error('Math.random is forbidden: use the seeded rng'); };

const L = window.LESSON, T = { ...window.THEME }, SEGS = window.SEGMENTS, WORDS = window.WORDS;
if (L.frame.min_font) T.minFontPx = L.frame.min_font;   // a landscape frame (YouTube, a class screen) is seen bigger than a phone: its own minimum
if (!L || !T || !SEGS || !WORDS) throw new Error('lesson, theme, segments or words missing');
const NS = 'http://www.w3.org/2000/svg';
const FW = L.frame.w, FHt = L.frame.h, MARGIN = L.frame.margin;
const $ = id => document.getElementById(id);
const stage = $('stage'), board = $('board');
// Instagram/TikTok safe area (frame.safe: { top, bottom, left, right } px); without it every side keeps frame.margin
const SAFE = { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, ...(L.frame.safe || {}) };
const SCALE = innerWidth / FW;

// ---------- theme ----------
const ROLES = ['ink', 'shape', 'shape2', 'accent', 'paper'];   // shape2: an optional second category colour (not an accent)
const color = role => { if (!ROLES.includes(role)) throw new Error(`colour "${role}" is not a theme role (${ROLES.join(', ')})`); if (!T[role]) throw new Error(`theme.json has no "${role}" colour`); return T[role]; };
function applyTheme() {
  const r = document.documentElement.style;
  r.setProperty('--paper', T.paper); r.setProperty('--ink', T.ink);
  for (const el of [stage, board]) { el.style.width = FW + 'px'; el.style.height = FHt + 'px'; }
  stage.style.transform = `scale(${SCALE})`;
  const ov = $('ov'); ov.setAttribute('width', FW); ov.setAttribute('height', FHt); ov.setAttribute('viewBox', `0 0 ${FW} ${FHt}`);
  $('paperBase').setAttribute('fill', T.paper);
  const tx = T.texture, m = (rgb, a) => `0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  ${a[0]} 0 0 0 ${a[1]}`;
  $('grainM').setAttribute('values', m(tx.grainRGB, tx.grainAlpha));
  $('fibreM').setAttribute('values', m(tx.fibreRGB, tx.fibreAlpha));
  $('grainRect').setAttribute('opacity', tx.grainOpacity);
  const gp = tx.grid; if (!gp) return;            // optional squared notebook paper
  const ln = document.createElementNS(NS, 'path'); let d = '';     // squared lines as one plain path
  if (gp.kind !== 'lines') for (let x = -600; x <= 2520; x += gp.size) d += `M${x} -600V2520`;     // kind "lines": ruled paper
  for (let y = -600; y <= 2520; y += gp.size) d += `M-600 ${y}H2520`;
  for (const [k, v] of Object.entries({ d, fill: 'none', stroke: gp.color, 'stroke-width': gp.width || 2, opacity: gp.opacity ?? 1 })) ln.setAttribute(k, v);
  $('paper').insertBefore(ln, $('grainRect'));
  if (gp.margin_x !== undefined) {                 // a vertical margin line, like an exercise book
    const m = document.createElementNS(NS, 'path');
    for (const [k, v] of Object.entries({ d: `M${gp.margin_x} -600V2520`, stroke: gp.margin_color || gp.color, 'stroke-width': (gp.width || 2) * 1.5, opacity: gp.opacity ?? 1 })) m.setAttribute(k, v);
    $('paper').insertBefore(m, $('grainRect'));
  }
}

// ---------- seeded randomness ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rngFor = key => mulberry32(L.seed ^ hashStr(key));

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smoother = x => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const easeStroke = x => 0.2 * x + 0.8 * (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeWipe = x => 0.25 * x + 0.75 * (1 - Math.pow(1 - x, 1.7));
const f1 = v => v.toFixed(1);

// ---------- anchors: a segment start, or a spoken word ----------
const segStart = n => SEGS[n - 1].start;
function anchorOf(a) {
  if (!a || !a.segment) throw new Error('every event needs an anchor with a segment');
  if (a.end) return { type: 'seg', text: `seg ${a.segment} end`, time: SEGS[a.segment - 1].end, note: '' };
  if (a.word === undefined) return { type: 'seg', text: `seg ${a.segment} start`, time: segStart(a.segment), note: '' };
  const w = WORDS.find(w => w.seg === a.segment && w.i === a.index);
  if (!w || w.text.replace(/[،:.!؟?,]/g, '') !== a.word) throw new Error(`anchor word «${a.word}» not found at segment ${a.segment}, index ${a.index}`);
  if (w.reliable) return { type: 'word', text: a.word, time: w.start, note: w.snapped ? 'start snapped to silence end' : '' };
  // fallback_offset is optional: without it, the unclear word's heard time is used as it is
  return { type: 'seg', text: `seg ${a.segment} (fallback: «${a.word}» unreliable)`, time: segStart(a.segment) + (a.fallback_offset ?? w.start - segStart(a.segment)), note: 'fallback' };
}

// ---------- pen geometry ----------
function catmull(P, m) {
  const out = [], Q = [P[0], ...P, P[P.length - 1]];
  for (let i = 1; i < Q.length - 2; i++)
    for (let j = i === 1 ? 0 : 1; j <= m; j++) {
      const u = j / m, u2 = u * u, u3 = u2 * u, a = Q[i - 1], b = Q[i], c = Q[i + 1], d = Q[i + 2];
      out.push([0, 1].map(k => 0.5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u3)));
    }
  return out;
}
function densify(P, step) {
  const out = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const [x0, y0] = P[i - 1], [x1, y1] = P[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let j = 1; j <= n; j++) out.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n]);
  }
  return out;
}
// hand-drawn symbols in a unit box (x 0..1, y 0..1, y down): 'c' = smooth curve, 'l' = straight segments
const GLYPHS = {
  '1': { w: 0.5, s: [['l', [[0.05, 0.26], [0.62, 0.02], [0.62, 1.0]]]] },
  '2': { w: 0.62, s: [['c', [[0.06, 0.24], [0.26, 0.03], [0.62, 0.0], [0.9, 0.2], [0.82, 0.46], [0.45, 0.76], [0.06, 0.99]]], ['l', [[0.06, 0.99], [0.98, 0.97]]]] },
  '3': { w: 0.6, s: [['c', [[0.08, 0.12], [0.45, 0.0], [0.86, 0.12], [0.8, 0.36], [0.4, 0.48], [0.88, 0.62], [0.9, 0.86], [0.5, 1.0], [0.06, 0.88]]]] },
  '4': { w: 0.66, s: [['l', [[0.6, 0.0], [0.04, 0.68], [0.98, 0.68]]], ['l', [[0.7, 0.3], [0.7, 1.0]]]] },
  '+': { w: 1, s: [['l', [[0.0, 0.52], [1.0, 0.48]]], ['l', [[0.5, 0.0], [0.52, 1.0]]]] },
  '=': { w: 1, s: [['l', [[0.0, 0.3], [1.0, 0.28]]], ['l', [[0.02, 0.76], [1.0, 0.74]]]] },
  '-': { w: 1, s: [['l', [[0.0, 0.5], [1.0, 0.48]]]] },
};
// a hand loop in glyph units (centre cu, cv; radii ru across, rv down), started at the top, pen moving left
function ringPts(cu, cv, ru, rv, turns = 1.08, n = 12) {
  const out = [];
  for (let i = 0; i <= Math.ceil(n * turns); i++) { const th = -Math.PI / 2 - i / n * 2 * Math.PI; out.push([cu + ru * Math.cos(th), cv + rv * Math.sin(th)]); }
  return out;
}
const dotPts = (cu, cv, r, gw) => ringPts(cu, cv, r / gw, r);   // a round dot of radius r (in glyph heights)
Object.assign(GLYPHS, {
  '0': { w: 0.62, s: [['c', ringPts(0.5, 0.5, 0.44, 0.49, 1.05)]] },
  '5': { w: 0.6, s: [['l', [[0.24, 0.03], [0.17, 0.45]]], ['c', [[0.17, 0.45], [0.5, 0.37], [0.86, 0.54], [0.86, 0.8], [0.54, 0.99], [0.08, 0.9]]], ['l', [[0.24, 0.03], [0.9, 0.02]]]] },
  '6': { w: 0.6, s: [['c', [[0.82, 0.06], [0.5, 0.03], [0.2, 0.3], [0.12, 0.66], [0.3, 0.97], [0.66, 0.96], [0.86, 0.72], [0.66, 0.5], [0.34, 0.5], [0.14, 0.68]]]] },
  '7': { w: 0.6, s: [['l', [[0.04, 0.04], [0.96, 0.02], [0.38, 1.0]]]] },
  '8': { w: 0.6, s: [['c', [[0.52, 0.47], [0.82, 0.3], [0.76, 0.07], [0.5, 0.01], [0.22, 0.08], [0.18, 0.3], [0.5, 0.47], [0.86, 0.7], [0.8, 0.93], [0.5, 0.99], [0.18, 0.92], [0.14, 0.7], [0.5, 0.47]]]] },
  '9': { w: 0.6, s: [['c', [[0.84, 0.3], [0.62, 0.04], [0.26, 0.06], [0.14, 0.28], [0.34, 0.48], [0.7, 0.42], [0.84, 0.26], [0.83, 0.62], [0.8, 1.0]]]] },
  '×': { w: 0.8, s: [['l', [[0.08, 0.18], [0.92, 0.82]]], ['l', [[0.92, 0.16], [0.08, 0.84]]]] },
  '÷': { w: 1, s: [['c', dotPts(0.5, 0.1, 0.05, 1)], ['l', [[0.0, 0.5], [1.0, 0.48]]], ['c', dotPts(0.5, 0.9, 0.05, 1)]] },
  '%': { w: 0.84, s: [['c', dotPts(0.24, 0.2, 0.15, 0.84)], ['l', [[0.88, 0.0], [0.12, 1.0]]], ['c', dotPts(0.76, 0.8, 0.15, 0.84)]] },
  '.': { w: 0.3, s: [['c', dotPts(0.5, 0.92, 0.045, 0.3)]] },
  // Arabic-Indic digits (lesson or event "digits": "arabic-indic" maps 0-9 . % onto these); still written left to right
  '٠': { w: 0.36, s: [['c', dotPts(0.5, 0.55, 0.08, 0.36)]] },
  '١': { w: 0.34, s: [['l', [[0.38, 0.0], [0.62, 1.0]]]] },
  '٢': { w: 0.6, s: [['c', [[0.14, 0.04], [0.3, 0.22], [0.58, 0.24], [0.8, 0.14], [0.9, 0.0]]], ['c', [[0.15, 0.06], [0.24, 0.5], [0.34, 1.0]]]] },
  '٣': { w: 0.72, s: [['c', [[0.12, 0.04], [0.24, 0.2], [0.4, 0.17], [0.5, 0.03], [0.6, 0.18], [0.78, 0.14], [0.92, 0.0]]], ['c', [[0.13, 0.06], [0.23, 0.5], [0.33, 1.0]]]] },
  '٤': { w: 0.56, s: [['c', [[0.86, 0.04], [0.46, 0.04], [0.3, 0.2], [0.5, 0.38], [0.78, 0.44], [0.42, 0.5], [0.2, 0.68], [0.3, 0.92], [0.86, 0.96]]]] },
  '٥': { w: 0.56, s: [['c', ringPts(0.5, 0.6, 0.4, 0.38, 1.05)]] },
  '٦': { w: 0.56, s: [['c', [[0.08, 0.06], [0.4, 0.15], [0.7, 0.1], [0.72, 0.55], [0.74, 1.0]]]] },
  '٧': { w: 0.8, s: [['l', [[0.04, 0.0], [0.5, 1.0], [0.96, 0.0]]]] },
  '٨': { w: 0.8, s: [['l', [[0.04, 1.0], [0.5, 0.0], [0.96, 1.0]]]] },
  '٩': { w: 0.56, s: [['c', [[0.8, 0.3], [0.62, 0.04], [0.28, 0.06], [0.18, 0.3], [0.4, 0.48], [0.76, 0.4], [0.8, 0.22], [0.8, 0.6], [0.78, 1.0]]]] },
  '٫': { w: 0.3, s: [['c', [[0.62, 0.7], [0.58, 0.86], [0.38, 1.0]]]] },
  '?': { w: 0.56, s: [['c', [[0.1, 0.2], [0.3, 0.03], [0.68, 0.02], [0.88, 0.2], [0.75, 0.4], [0.5, 0.52], [0.48, 0.72]]], ['c', dotPts(0.48, 0.93, 0.05, 0.56)]] },
  '<': { w: 0.7, s: [['l', [[0.92, 0.12], [0.08, 0.5], [0.92, 0.88]]]] },
  '>': { w: 0.7, s: [['l', [[0.08, 0.12], [0.92, 0.5], [0.08, 0.88]]]] },
  // algebra: the variable x (lower-case height), relations, sets and intervals
  'x': { w: 0.56, s: [['c', [[0.06, 0.42], [0.3, 0.42], [0.5, 0.7], [0.7, 0.98], [0.94, 0.96]]], ['c', [[0.92, 0.42], [0.64, 0.56], [0.4, 0.84], [0.08, 1.0]]]] },
  '≥': { w: 0.7, s: [['l', [[0.1, 0.08], [0.9, 0.4], [0.1, 0.72]]], ['l', [[0.1, 0.94], [0.9, 0.92]]]] },
  '≤': { w: 0.7, s: [['l', [[0.9, 0.08], [0.1, 0.4], [0.9, 0.72]]], ['l', [[0.1, 0.94], [0.9, 0.92]]]] },
  '∈': { w: 0.62, s: [['c', [[0.92, 0.12], [0.45, 0.07], [0.1, 0.3], [0.1, 0.7], [0.45, 0.93], [0.92, 0.88]]], ['l', [[0.12, 0.5], [0.8, 0.5]]]] },
  '∞': { w: 1.25, s: [['c', [[0.5, 0.5], [0.7, 0.22], [0.93, 0.28], [0.96, 0.56], [0.74, 0.78], [0.5, 0.5], [0.26, 0.22], [0.05, 0.32], [0.06, 0.62], [0.3, 0.78], [0.5, 0.5]]]] },
  ',': { w: 0.26, s: [['c', [[0.62, 0.8], [0.56, 0.96], [0.3, 1.12]]]] },
  '[': { w: 0.32, s: [['l', [[0.88, 0.0], [0.22, 0.0], [0.22, 1.0], [0.88, 1.0]]]] },
  ']': { w: 0.32, s: [['l', [[0.12, 0.0], [0.78, 0.0], [0.78, 1.0], [0.12, 1.0]]]] },
  '{': { w: 0.36, s: [['c', [[0.9, 0.0], [0.5, 0.06], [0.52, 0.42], [0.12, 0.5], [0.52, 0.58], [0.5, 0.94], [0.9, 1.0]]]] },
  '}': { w: 0.36, s: [['c', [[0.1, 0.0], [0.5, 0.06], [0.48, 0.42], [0.88, 0.5], [0.48, 0.58], [0.5, 0.94], [0.1, 1.0]]]] },
  '٪': { w: 0.84, s: [['c', dotPts(0.22, 0.2, 0.08, 0.84)], ['l', [[0.88, 0.0], [0.12, 1.0]]], ['c', dotPts(0.78, 0.8, 0.08, 0.84)]] },
});
const AR_DIGITS = { 0: '٠', 1: '١', 2: '٢', 3: '٣', 4: '٤', 5: '٥', 6: '٦', 7: '٧', 8: '٨', 9: '٩', '.': '٫', '%': '٪' };
function mapDigits(s, mode = L.digits || 'latin') {
  if (mode === 'latin') return s;
  if (mode !== 'arabic-indic') throw new Error(`digits must be "latin" or "arabic-indic", not "${mode}"`);
  return [...s].map(c => AR_DIGITS[c] || c).join('');
}
// a number written left to right as one pen event; operators inside a number are drawn smaller
const SMALL = { '+': 0.55, '-': 0.55, '=': 0.45, '×': 0.5, '÷': 0.6, '<': 0.55, '>': 0.55, '≥': 0.6, '≤': 0.6, '∈': 0.6, '∞': 0.5, ',': 0.8 };
function numberLayout(s, h) {
  const cs = [...s], hs = cs.map(c => h * (SMALL[c] || 1)), ws = cs.map((c, i) => { if (!GLYPHS[c]) throw new Error(`no hand-drawn glyph for "${c}" in "${s}" (have: ${Object.keys(GLYPHS).join(' ')})`); return GLYPHS[c].w * hs[i]; });
  const gaps = cs.slice(1).map((c, i) => ('.٫'.includes(c) || '.٫'.includes(cs[i]) ? 0.05 : 0.14) * h);
  return { cs, hs, ws, gaps, w: ws.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0) };
}
function numberPaths(s, cx, cy, h, key) {
  const n = numberLayout(s, h), ds = []; let x = cx - n.w / 2;
  n.cs.forEach((c, i) => { ds.push(...glyphPaths(c, x + n.ws[i] / 2, cy, n.hs[i], `${key}:${i}`)); x += n.ws[i] + (n.gaps[i] || 0); });
  return { ds, w: n.w };
}
function glyphPaths(ch, cx, cy, h, key) {
  const g = GLYPHS[ch]; if (!g) throw new Error(`no hand-drawn glyph for "${ch}" (have: ${Object.keys(GLYPHS).join(' ')})`);
  const r = rngFor(key), w = g.w * h;
  const rot = (r() - 0.5) * 0.07, slant = 0.07 + (r() - 0.5) * 0.04, sx = 1 + (r() - 0.5) * 0.08, sy = 1 + (r() - 0.5) * 0.06;
  const A = 0.018 * h, ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28], fq = [1.3 + r(), 2.1 + r(), 1.1 + r(), 2.6 + r()];
  return g.s.map(([kind, P], si) => {
    const pts = kind === 'c' ? catmull(P, 14) : densify(P, 0.06);
    let d = '';
    pts.forEach(([u, v], i) => {
      const q = i / Math.max(1, pts.length - 1) + si * 0.37;
      let x = (u - 0.5) * w * sx, y = (v - 0.5) * h * sy;
      x += A * (0.7 * Math.sin(q * 6.28 * fq[0] + ph[0]) + 0.3 * Math.sin(q * 6.28 * fq[1] + ph[1]));
      y += A * (0.7 * Math.sin(q * 6.28 * fq[2] + ph[2]) + 0.3 * Math.sin(q * 6.28 * fq[3] + ph[3]));
      x -= y * slant;
      const X = cx + x * Math.cos(rot) - y * Math.sin(rot), Y = cy + x * Math.sin(rot) + y * Math.cos(rot);
      d += (i ? 'L' : 'M') + f1(X) + ' ' + f1(Y);
    });
    return d;
  });
}
function wobbly(polys, amp, key) {
  const r = rngFor(key); let d = '';
  for (const pts of polys) {
    let first = true;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const n = Math.max(2, Math.ceil(len / 16)), nx = -dy / len, ny = dx / len, ph = r() * 6.283, k = 0.6 + r() * 1.4;
      for (let j = first ? 0 : 1; j <= n; j++) {
        const u = j / n, w = amp * Math.sin(u * Math.PI * k + ph) * Math.sin(u * Math.PI) + (r() - 0.5) * amp * 0.25;
        d += (first ? 'M' : 'L') + f1(x0 + dx * u + nx * w) + ' ' + f1(y0 + dy * u + ny * w); first = false;
      }
    }
  }
  return d;
}
function loop(cx, cy, rx, ry, key) {
  const r = rngFor(key), th0 = -2.3 + (r() - 0.5) * 0.5, ph = r() * 6.283, n = 90; let d = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n, th = th0 - u * 1.1 * 2 * Math.PI, s = 1 + 0.035 * Math.sin(3 * th + ph) - 0.06 * u;
    d += (i ? 'L' : 'M') + f1(cx + rx * s * Math.cos(th)) + ' ' + f1(cy + ry * s * Math.sin(th));
  }
  return d;
}
function hatch(x0, x1, y0, y1, step, slant) {
  const pts = []; let top = true;
  for (let x = x0; x <= x1 + 0.01; x += step) { pts.push(top ? [x + slant, y0] : [x, y1]); top = !top; }
  return pts;
}
function arrowPolys(x0, y0, x1, y1, head) {
  const a = Math.atan2(y1 - y0, x1 - x0), h = head;
  return [[[x0, y0], [x1, y1]], [[x1 - h * Math.cos(a - 0.5), y1 - h * Math.sin(a - 0.5)], [x1, y1], [x1 - h * Math.cos(a + 0.5), y1 - h * Math.sin(a + 0.5)]]];
}

// smooth hand curve through points: low-frequency sideways wobble, endpoints kept exact
function smoothWobble(pts, amp, key) {
  const r = rngFor(key), pa = r() * 6.283, pb = r() * 6.283, fa = 0.8 + r() * 1.2, fb = 2.5 + r() * 2, P = densify(pts, 6), acc = [0];
  for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = acc.at(-1) || 1; let d = '';
  P.forEach(([x, y], i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, u = acc[i] / total;
    const o = amp * (0.75 * Math.sin(6.283 * fa * u + pa) + 0.25 * Math.sin(6.283 * fb * u + pb)) * Math.sin(Math.PI * u);
    d += (i ? 'L' : 'M') + f1(x - dy / len * o) + ' ' + f1(y + dx / len * o);
  });
  return d;
}
function ring(cx, cy, r, key, ry = r) {                  // a closed hand circle: starts near the top, clockwise, overlaps 4 %
  const g = rngFor(key), th0 = -Math.PI / 2 - 0.35 + (g() - 0.5) * 0.3, pa = g() * 6.283, pb = g() * 6.283, n = 120; let d = '';
  for (let i = 0; i <= n; i++) {
    const u = i / n, th = th0 + u * 1.04 * 2 * Math.PI, s = 1 + 0.012 * Math.sin(2 * th + pa) + 0.007 * Math.sin(5 * th + pb) - 0.012 * u;
    d += (i ? 'L' : 'M') + f1(cx + r * s * Math.cos(th)) + ' ' + f1(cy + ry * s * Math.sin(th));
  }
  return d;
}
function chordY(poly, x) {                       // top and bottom of a convex polygon at a given x
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    if ((x - x0) * (x - x1) > 0) continue;
    if (x0 === x1) { lo = Math.min(lo, y0, y1); hi = Math.max(hi, y0, y1); }
    else { const y = y0 + (y1 - y0) * (x - x0) / (x1 - x0); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  return hi - lo > 6 ? [lo, hi] : null;
}
function hatchPoly(poly, step, slant) {          // the bar's zigzag hatching, clipped to any convex polygon
  const xs = poly.map(p => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs), pts = []; let top = true;
  for (let x = x0 + step * 0.4; x <= x1; x += step) {
    const X = top ? x + slant : x, c = chordY(poly, X); if (!c) continue;
    pts.push([X, top ? c[0] : c[1]]); top = !top;
  }
  if (pts.length < 2) throw new Error('shaded region is too small to hatch');
  return pts;
}
function sectorPoly(P, k, inset) {               // part k of a pie, pulled in by `inset` px on every side (convex)
  const R = P.r - inset, m = Math.max(8, Math.ceil(R * 2 * Math.PI / P.n / 12));
  if (P.n === 1) return Array.from({ length: 64 }, (_, i) => [P.x + R * Math.cos(i / 64 * 2 * Math.PI), P.y + R * Math.sin(i / 64 * 2 * Math.PI)]);
  const a1 = P.a0 + k * 2 * Math.PI / P.n, a2 = a1 + 2 * Math.PI / P.n, mid = (a1 + a2) / 2, half = Math.PI / P.n;
  const off = inset / Math.sin(Math.min(half, Math.PI / 2)), da = Math.asin(Math.min(1, inset / R)), out = [[P.x + off * Math.cos(mid), P.y + off * Math.sin(mid)]];
  for (let i = 0; i <= m; i++) { const a = a1 + da + (a2 - a1 - 2 * da) * i / m; out.push([P.x + R * Math.cos(a), P.y + R * Math.sin(a)]); }
  return out;
}

// ---------- expressions: "(3+5) ÷ 2^2 + 1/2", "2 3/4", "7 × □ = 21" laid out as maths, written left to right ----------
// a/b is a stacked fraction (a group in it loses its brackets), a^b a power, "2 1/2" a mixed number, □ a blank box, * → ×, : → ÷
const EXPR_OPS = { '+': '+', '-': '-', '×': '×', '*': '×', '÷': '÷', ':': '÷', '=': '=', '<': '<', '>': '>', '≥': '≥', '>=': '≥', '≤': '≤', '<=': '≤', '∈': '∈', ',': ',' };
const RELS = '=<>≥≤∈';
function parseExpr(src) {
  const toks = [], re = /\s+|\d+(?:\.\d+)?%?|>=|<=|[-+×÷=<>*:/^()?□√≥≤∈∞,\[\]{}x]/y;
  while (re.lastIndex < src.length) { const at = re.lastIndex, m = re.exec(src); if (!m) throw new Error(`expr "${src}": cannot read "${src.slice(at)}"`); if (!/^\s+$/.test(m[0])) toks.push(m[0]); }
  let i = 0;
  const bad = what => { throw new Error(`expr "${src}": ${what}`); };
  const unwrap = n => n.k === 'group' && n.open === '(' ? { k: 'seq', items: n.items } : n;
  function primary() {
    const t = toks[i++];
    if (t === undefined) bad('ends too early');
    if (/^\d/.test(t) && toks[i] === 'x') { i++; return { k: 'num', s: t + 'x' }; }          // 8x: a number times the variable
    if (/^\d/.test(t) || t === '?' || t === 'x' || t === '∞') return { k: 'num', s: t };
    if (t === '□') return { k: 'blank' };
    if (t === '√') return { k: 'sqrt', c: unwrap(primary()) };
    if ('([{'.includes(t)) {                     // (…) [a, b) {8}: the closing bracket may differ (intervals)
      const items = seq(')]}'), c = toks[i++];
      if (!c || !')]}'.includes(c)) bad(`a "${t}" is not closed`);
      return { k: 'group', items, open: t, close: c };
    }
    bad(`unexpected "${t}"`);
  }
  function operand() {
    let a = primary();
    if (toks[i] === '^') { i++; a = { k: 'pow', b: a, e: unwrap(primary()) }; }
    if (toks[i] === '/') { i++; let d = primary(); if (toks[i] === '^') { i++; d = { k: 'pow', b: d, e: unwrap(primary()) }; } a = { k: 'frac', n: unwrap(a), d: unwrap(d) }; }
    return a;
  }
  function seq(close) {
    const items = [];
    while (i < toks.length && !(close && close.includes(toks[i]))) {
      const t = toks[i];
      if (EXPR_OPS[t]) { items.push({ k: 'op', s: EXPR_OPS[t] }); i++; continue; }
      const o = operand(), last = items.at(-1);
      if (last && last.k !== 'op') {
        if (last.k === 'num' && o.k === 'frac' && o.n.k === 'num' && o.d.k === 'num' && !/x/.test(last.s + o.n.s + o.d.s)) items[items.length - 1] = { k: 'mixed', w: last, f: o };
        else if (o.k === 'group' || o.k === 'sqrt' || (o.k === 'num' && o.s === 'x')) items.push({ k: 'op', s: '×', implicit: true }, o);   // 2√(…), 4(…): multiply
        else bad('two terms with no operator between them');
      } else items.push(o);
    }
    return items;
  }
  const items = seq(undefined);
  if (i < toks.length) bad(`unexpected "${toks[i]}"`);
  return items;
}
// layout: every box is { w, up, dn, marks } around a horizontal axis at y = 0 (the fraction bar line); marks are in drawing order
const exprGap = (a, b, h) => (a.implicit || b.implicit ? 0.03 : a.k === 'op' || b.k === 'op' ? 0.3 : 0.14) * h;   // more air around operators, none for 2√…
function layExpr(n, h, dig) {
  const mv = (L, dx, dy) => L.marks.map(m => ({ ...m, x: m.x + dx, y: m.y + dy }));
  switch (n.k) {
    case 'num': {
      const N = numberLayout(mapDigits(n.s, dig), h), marks = []; let x = 0;
      N.cs.forEach((c, j) => { marks.push({ t: 'g', c, x: x + N.ws[j] / 2, y: 0, h: N.hs[j] }); x += N.ws[j] + (N.gaps[j] || 0); });
      return { w: N.w, up: h / 2, dn: h / 2, marks };
    }
    case 'op': {
      if (n.implicit) return { w: 0.02 * h, up: h / 2, dn: h / 2, marks: [] };
      const hh = h * (SMALL[n.s] || 0.5), w = GLYPHS[n.s].w * hh, y = n.s === ',' ? h * 0.1 : 0;
      return { w, up: h / 2, dn: h / 2, marks: [{ t: 'g', c: n.s, x: w / 2, y, h: hh }] };
    }
    case 'sqrt': {                                  // tick, down stroke, long up stroke, then the bar over the content
      const C = layExpr(n.c, h, dig), top = -(Math.max(C.up, 0.5 * h) + 0.12 * h), bot = Math.max(C.dn, 0.5 * h) + 0.04 * h, cx = 0.62 * h;
      const pts = [[0, 0.12 * h], [0.12 * h, 0.02 * h], [0.3 * h, bot], [0.52 * h, top], [cx + C.w + 0.1 * h, top]];
      return { w: cx + C.w + 0.14 * h, up: -top + 0.04 * h, dn: bot, marks: [{ t: 'root', x: 0, y: 0, pts }, ...mv(C, cx, 0)] };
    }
    case 'blank': return { w: 0.78 * h, up: h / 2, dn: h / 2, marks: [{ t: 'box', x: 0, y: -0.46 * h, w: 0.78 * h, h: 0.92 * h }] };
    case 'frac': {
      const N = layExpr(n.n, h * 0.72, dig), D = layExpr(n.d, h * 0.72, dig), g = 0.13 * h, W = Math.max(N.w, D.w) + 0.34 * h;
      return { w: W, up: g + N.dn + N.up, dn: g + D.up + D.dn,
        marks: [...mv(N, (W - N.w) / 2, -(g + N.dn)), { t: 'bar', x: 0.04 * h, y: 0, w: W - 0.08 * h }, ...mv(D, (W - D.w) / 2, g + D.up)] };
    }
    case 'mixed': { const A = layExpr(n.w, h, dig), F = layExpr(n.f, h, dig), gx = 0.06 * h;
      return { w: A.w + gx + F.w, up: Math.max(A.up, F.up), dn: Math.max(A.dn, F.dn), marks: [...A.marks, ...mv(F, A.w + gx, 0)] }; }
    case 'pow': { const B = layExpr(n.b, h, dig), E = layExpr(n.e, h * 0.55, dig), dy = -B.up * 0.95, gx = 0.07 * h;
      return { w: B.w + gx + E.w, up: Math.max(B.up, -dy + E.up), dn: B.dn, marks: [...B.marks, ...mv(E, B.w + gx, dy)] }; }
    case 'group': {
      const C = layExpr({ k: 'seq', items: n.items }, h, dig), top = Math.max(C.up, 0.5 * h) + 0.07 * h, bot = Math.max(C.dn, 0.5 * h) + 0.07 * h;
      const pw = 0.14 * h + 0.06 * (top + bot), gx = 0.06 * h;
      return { w: 2 * pw + 2 * gx + C.w, up: top, dn: bot,
        marks: [{ t: 'paren', kind: n.open || '(', side: -1, x: 0, y: -top, w: pw, h: top + bot }, ...mv(C, pw + gx, 0), { t: 'paren', kind: n.close || ')', side: 1, x: pw + 2 * gx + C.w, y: -top, w: pw, h: top + bot }] };
    }
    case 'seq': {
      const Ls = n.items.map(it => layExpr(it, h, dig)), marks = []; let x = 0;
      Ls.forEach((L, j) => { if (j) x += exprGap(n.items[j - 1], n.items[j], h); marks.push(...mv(L, x, 0)); x += L.w; });
      return { w: x, up: Math.max(h / 2, ...Ls.map(L => L.up)), dn: Math.max(h / 2, ...Ls.map(L => L.dn)), marks };
    }
  }
  throw new Error(`expr: unknown node ${n.k}`);
}
// maths check: every = < > in an expr must be true, and a row starting with "=" must equal the row before it (same column)
function exprVal(n) {
  const both = (a, b, f) => a === null || b === null ? null : f(a, b);
  switch (n.k) {
    case 'num': {
      if (n.s === '?') return null;
      if (n.s === '∞') return Infinity;
      if (n.s.endsWith('x')) { const X = L.variables && L.variables.x; return X === undefined ? null : (n.s === 'x' ? 1 : parseFloat(n.s)) * X; }
      return n.s.endsWith('%') ? parseFloat(n.s) / 100 : parseFloat(n.s);
    }
    case 'sqrt': { const v = exprVal(n.c); return v === null ? null : Math.sqrt(v); }
    case 'blank': return null;
    case 'frac': return both(exprVal(n.n), exprVal(n.d), (a, b) => a / b);
    case 'mixed': return both(exprVal(n.w), exprVal(n.f), (a, b) => a + b);
    case 'pow': return both(exprVal(n.b), exprVal(n.e), Math.pow);
    case 'group': return n.open && n.open !== '(' ? null : seqVal(n.items);   // intervals and sets have no single value
    default: return seqVal(n.items);
  }
}
function seqVal(items) {                          // usual precedence: × ÷ before + −; null when a ? or □ is inside
  const vals = [], ops = []; let neg = false;
  items.forEach((it, j) => {
    if (it.k === 'op') { if (j === 0 && it.s === '-') neg = true; else ops.push(it.s); return; }
    const v = exprVal(it); vals.push(v !== null && neg ? -v : v); neg = false;
  });
  if (vals.includes(null) || ops.includes(',')) return null;
  if (vals.length !== ops.length + 1) return NaN;
  const v2 = [vals[0]], o2 = [];
  ops.forEach((o, j) => { if (o === '×' || o === '÷') { const a = v2.pop(); v2.push(o === '×' ? a * vals[j + 1] : a / vals[j + 1]); } else { o2.push(o); v2.push(vals[j + 1]); } });
  return o2.reduce((acc, o, j) => o === '+' ? acc + v2[j + 1] : acc - v2[j + 1], v2[0]);
}
const MATH = [], CHAIN = {};
function checkMath(ev, items) {
  const sides = [[]], rels = [];
  for (const it of items) if (it.k === 'op' && RELS.includes(it.s)) { rels.push(it.s); sides.push([]); } else sides.at(-1).push(it);
  const chainKey = ev.column || '(previous expr)', cont = sides[0].length === 0;
  const vals = sides.map(sd => sd.length ? seqVal(sd) : null), same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (cont) vals[0] = CHAIN[chainKey] ?? null;
  const bad = [];
  rels.forEach((r, j) => {
    const a = vals[j], b = vals[j + 1];
    if (a === null || b === null) return;
    if (Number.isNaN(a) || Number.isNaN(b)) { bad.push('cannot read the expression'); return; }
    if (r === '∈') return;
    const ok = r === '=' ? same(a, b) : r === '<' ? a < b : r === '>' ? a > b : r === '≥' ? a >= b - 1e-9 : a <= b + 1e-9;
    if (!ok) bad.push(`${+a.toFixed(6)} ${r} ${+b.toFixed(6)} is false${L.variables ? ' (with ' + JSON.stringify(L.variables) + ')' : ''}`);
  });
  const last = vals.filter(v => v !== null && !Number.isNaN(v)).at(-1);
  if (last !== undefined) CHAIN[chainKey] = last;
  MATH.push({ id: ev.id, text: ev.text, ok: bad.length === 0 || !!ev.wrong_on_purpose, onPurpose: !!ev.wrong_on_purpose, detail: bad.join('; ') });
  if (bad.length && !ev.wrong_on_purpose) throw new Error(`expr "${ev.id}" («${ev.text}») is wrong: ${bad.join('; ')} — fix it, or set "wrong_on_purpose": true to show a mistake`);
}
function markPaths(m, X, Y, key) {                // one layout mark → pen paths, at origin (X, Y)
  const x = X + m.x, y = Y + m.y;
  if (m.t === 'g') return glyphPaths(m.c, x, y, m.h, key);
  if (m.t === 'bar') return [wobbly([[[x, y + 1.5], [x + m.w, y - 1.5]]], 1.6, key)];
  if (m.t === 'box') return [wobbly([[[x, y], [x + m.w, y], [x + m.w, y + m.h], [x, y + m.h], [x, y - 2]]], 1.4, key)];
  if (m.t === 'root') return [wobbly([m.pts.map(([px, py]) => [x + px, y + py])], 1.2, key)];
  if (m.t === 'paren' && (m.kind === '[' || m.kind === ']')) {        // square bracket
    const a = m.side < 0 ? x + m.w * 0.85 : x + m.w * 0.15, b = m.side < 0 ? x + m.w * 0.3 : x + m.w * 0.7;
    return [wobbly([[[a, y], [b, y], [b, y + m.h], [a, y + m.h]]], 0.8, key)];
  }
  if (m.t === 'paren' && (m.kind === '{' || m.kind === '}')) {        // brace
    const o = m.side < 0 ? [x + m.w * 0.9, x + m.w * 0.5, x + m.w * 0.12] : [x + m.w * 0.1, x + m.w * 0.5, x + m.w * 0.88];
    return [smoothWobble(catmull([[o[0], y], [o[1], y + m.h * 0.08], [o[1], y + m.h * 0.42], [o[2], y + m.h * 0.5], [o[1], y + m.h * 0.58], [o[1], y + m.h * 0.92], [o[0], y + m.h]], 8), 0.8, key)];
  }
  const o = m.side < 0 ? [x + m.w * 0.95, x + m.w * 0.12] : [x + m.w * 0.05, x + m.w * 0.88];   // paren: outer tips, bulge
  return [smoothWobble(catmull([[o[0], y], [o[1] + (o[0] - o[1]) * 0.3, y + m.h * 0.22], [o[1], y + m.h * 0.5], [o[1] + (o[0] - o[1]) * 0.3, y + m.h * 0.78], [o[0], y + m.h]], 10), 1.2, key)];
}

// ---------- flow layout (lesson.layout.flow): rows placed under each other, or `beside` the last row ----------
const FLOW_ON = !!(L.layout && L.layout.flow);
let ROW = null;
const flows = (ev, k) => FLOW_ON && ev[k] === undefined && ev.in_block !== false && !ev.center_in_frame;
function flowTop(ev, h) {
  if (ev.beside) {
    if (!ROW) throw new Error(`"${ev.id}": beside needs an earlier row`);
    const top = ROW.top + Math.max(0, (ROW.h - h) / 2); ROW.bottom = Math.max(ROW.bottom, top + h); return top;
  }
  const top = ROW ? ROW.bottom + (ev.gap ?? L.layout.gap ?? 56) : 0; ROW = { top, h, bottom: top + h }; return top;
}

// ---------- scenes: a `scene` event turns the page; every scene is centred on its own and never moves ----------
const SCENED = L.events.some(e => e.tool === 'scene') || !!L.frame.fit,   // a fitted lesson is boards even with one board (it is scaled like the others)
      SCENES = [{ id: 'scene0', start: -1e9, fade: 0 }];
let CUR = 0;
function sceneBox(k) {
  const S = SCENES[k]; if (S.g) return S;
  if (!$('gScenes')) { const g = document.createElementNS(NS, 'g'); g.id = 'gScenes'; $('ov').insertBefore(g, $('gMark')); }
  S.g = document.createElementNS(NS, 'g'); S.g.id = 'sc' + k;
  for (const n of ['gShade', 'gLine']) { const l = document.createElementNS(NS, 'g'); l.id = `sc${k}_${n}`; l.setAttribute('filter', 'url(#inkStroke)'); S.g.appendChild(l); }
  $('gScenes').appendChild(S.g);
  S.texts = document.createElement('div'); S.texts.className = 'texts'; Object.assign(S.texts.style, { position: 'absolute', left: '0px', top: '0px' });
  board.insertBefore(S.texts, $('ov'));
  return S;
}
const layerOf = n => SCENED && (n === 'gShade' || n === 'gLine') ? `sc${CUR}_${n}` : n;

// ---------- registries ----------
const EVENTS = [], NOM = {}, STROKES = {}, ORDER = [], PENDING = [];
let DY = 0, BLOCK = null;
function box(el) {
  const r = el.getBoundingClientRect(), s = board.getBoundingClientRect();
  return { x: (r.left - s.left) / SCALE, y: (r.top - s.top) / SCALE, w: r.width / SCALE, h: r.height / SCALE };
}
function inkBox(id) {                      // drawn extent of an element's strokes, stroke width included
  const ss = STROKES[id]; if (!ss) { const el = document.getElementById(id); if (el) return box(el); throw new Error(`arrow target "${id}" has no strokes`); }   // a written word: its text box
  let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
  for (const s of ss) { const q = s.el.getBBox(), p = s.width / 2; l = Math.min(l, q.x - p); t = Math.min(t, q.y - p); r = Math.max(r, q.x + q.width + p); b = Math.max(b, q.y + q.height + p); }
  return { x: l, y: t, w: r - l, h: b - t };
}

// ---------- event builders ----------
function mkPath(d, opt) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', opt.color); p.setAttribute('stroke-width', opt.width);
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('visibility', 'hidden');
  if (opt.opacity) p.setAttribute('stroke-opacity', opt.opacity);
  p.dataset.sense = opt.group; p.dataset.scene = opt.scene ?? CUR; if (opt.inBlock === false) p.dataset.block = '0';
  $(layerOf(opt.layer || 'gLine')).appendChild(p);
  const s = { el: p, width: opt.width };
  if (d !== null) setD(s, d);
  return s;
}
function setD(s, d) { s.el.setAttribute('d', d); s.L = s.el.getTotalLength(); s.el.setAttribute('stroke-dasharray', `${f1(s.L + 2)} ${f1(s.L + 4)}`); }
function timeStrokes(strokes) {            // pen lifts between strokes: 10 % of the event, or (calm pen) time in proportion to the distance travelled
  if (L.frame.pen && strokes.length > 1) {
    const gaps = strokes.slice(1).map((s, i) => { const a = strokes[i].el.getPointAtLength(strokes[i].L), b = s.el.getPointAtLength(0); return Math.hypot(b.x - a.x, b.y - a.y) / 1.6 + 4; });
    const total = strokes.reduce((a, s) => a + s.L, 0) + gaps.reduce((a, g) => a + g, 0);
    let acc = 0; strokes.forEach((s, i) => { s.a = acc; s.b = acc + s.L / total; acc = s.b + (gaps[i] || 0) / total; });
    return;
  }
  const total = strokes.reduce((a, s) => a + s.L, 0), lift = strokes.length > 1 ? 0.1 / (strokes.length - 1) : 0;
  let acc = 0; const draw = 1 - lift * (strokes.length - 1);
  strokes.forEach(s => { s.a = acc; s.b = acc + draw * s.L / total; acc = s.b + lift; });
}
// calm pen (frame.pen = { max_speed, min_dur, queue }): no drawing faster than max_speed px/s or shorter than min_dur;
// one pen at a time: a drawing that starts while another is still being drawn waits up to `queue` s, or draws without a pen
function penPlan() {
  const P = L.frame.pen; if (!P) return;
  const v = (P.max_speed ?? 1800) / Math.max(1, (L.frame.fit && L.frame.fit.max_scale) || 1), m = P.min_dur ?? 0.25, q = P.queue ?? 0.5;   // speed on screen: a board may be scaled up later
  for (const e of EVENTS) {
    if (e.type === 'pen' && e.strokes.length) {
      let len = e.strokes.reduce((a, s) => a + s.L, 0);
      e.strokes.slice(1).forEach((s, i) => { const a = e.strokes[i].el.getPointAtLength(e.strokes[i].L), b = s.el.getPointAtLength(0); len += Math.hypot(b.x - a.x, b.y - a.y) / 1.6; });
      e.dur = Math.max(e.dur, 1.5 * len / v, m);      // easeStroke peaks at ~1.5× the average speed
    } else if (e.type === 'wipe') e.dur = Math.max(e.dur, m, (e.el.offsetWidth || 0) / v);
  }
  let free = -1e9, moved = 0, maxShift = 0;
  for (const e of [...EVENTS].sort((a, b) => a.start - b.start)) {
    if (e.noTip || e.type === 'wash') continue;
    if (e.start < free - 1e-6) {
      const d = free - e.start;
      if (d <= q) { e.start += d; e.off += d; moved++; maxShift = Math.max(maxShift, d); }
      else { e.noTip = true; continue; }
    }
    free = e.start + e.dur + 0.04;
  }
  const deco = new Set([...BADGES.map(B => B.pen), ...WAVES.map(w => w.e)]);
  const lost = EVENTS.filter(e => e.noTip && !e.appear && !e.deco && !deco.has(e) && !/Txt$/.test(e.id));
  PEN = { moved, maxShift: +maxShift.toFixed(2), recaps: EVENTS.filter(e => e.appear).length, lost: lost.length, lostIds: lost.map(e => e.id) };
}
let PEN = null, IDLE = null;
function idleFill() {
  const I = L.frame.idle; if (!I || !SCENED) return;
  const max = I.max ?? 1.5, made = [];
  const work = () => EVENTS.filter(e => (!e.deco || e.timer) && e.scene !== 'g' && !(e.noTip && !e.appear && !e.pulse && e.type === 'pen' && /badge|voice/.test(e.id)));
  const ends = [...SEGS.map(s => s.end)], last = SEGS.at(-1).end;
  let acts = work().map(e => [e.start, e.start + e.dur, e]).sort((a, b) => a[0] - b[0]), t = 0, n = 0;
  for (let i = 0; i <= acts.length; i++) {
    const nextStart = i < acts.length ? acts[i][0] : last;
    while (nextStart - t > max + 0.05 && n < 400) {         // a gap: pulse the newest thing on the current board
      const at = t + 0.25, sc = SCENES.reduce((k, S, j) => S.start <= at ? j : k, 0), next = SCENES[sc + 1];
      if (next && at + 0.6 > next.start) break;
      const target = acts.filter(a => a[2].scene === sc && a[0] <= at && !a[2].pulse && !a[2].erases && !a[2].fade && !a[2].deco && a[2].group !== 'try' &&   // never point at a quiz option: it would look like a hint
        ((a[2].type === 'pen' && a[2].strokes.length) || a[2].type === 'wipe')).map(a => a[2]).at(-1);   // the newest drawing or text on this board
      if (!target) break;
      const id = `idle${n++}`, b = target.type === 'wipe' ? box(target.el) : (() => { const bs = target.strokes.map(s => s.el.getBBox()), x0 = Math.min(...bs.map(q => q.x)), y0 = Math.min(...bs.map(q => q.y));
        return { x: x0, y: y0, w: Math.max(...bs.map(q => q.x + q.width)) - x0, h: Math.max(...bs.map(q => q.y + q.height)) - y0 }; })();
      const save = CUR; CUR = sc;
      const e = penEvent(id, `keep the eye on ${target.id}`, { type: 'seg', text: 'idle fill', time: at, note: '' }, 0, 0.3, [wobbly([[[b.x - 10, b.y + b.h * 0.62 + 4], [b.x + b.w + 10, b.y + b.h * 0.62 - 4]]], 1.5, id)],
        { color: color('accent'), width: Math.min(44, Math.max(20, b.h * 0.5)), opacity: 0.2, group: 'pulse', layer: 'gShade', appear: true });
      CUR = save; e.pulse = true; e.noTip = true; e.fade = { at: at + Math.min(1.6, max), dur: 0.3 }; e.end = e.start + e.dur;
      e.dy = SCENES[sc].dy; e.sc = SCENES[sc]; e.at = (x, y) => e.sc.map ? e.sc.map(x, y) : [x, y + e.dy];
      made.push(id); t = at + Math.min(1.6, max) - 0.1;
    }
    if (i < acts.length) t = Math.max(t, acts[i][1]);
  }
  IDLE = { max, pulses: made.length };
}
// director lessons (frame.auto_trim): a drawing starts after its page turn has finished and ends before the next one;
// a piece pushed past the next turn by its neighbours is squeezed in just before it (drawn without a pen, and reported)
function autoTrim() {
  if (!L.frame.auto_trim || !SCENED) return;
  for (const e of EVENTS) {
    if (e.scene === 'g') continue;
    const S = SCENES[e.scene], next = SCENES[e.scene + 1];
    if (e.scene > 0 && e.start < S.start + S.fade) { e.off += S.start + S.fade + 0.02 - e.start; e.start = S.start + S.fade + 0.02; }
    if (next && e.start >= next.start - 0.1) {
      if (e.start - next.start > 1.0) throw new Error(`"${e.id}" is anchored after ${next.id} has turned the page: move its beat to the next step`);
      const s0 = Math.max(S.start + S.fade + 0.02, next.start - 0.3); e.off += s0 - e.start; e.start = s0; e.dur = Math.max(0.1, next.start - 0.02 - s0); e.noTip = true;
      if (!TRIMMED.includes(e.id)) TRIMMED.push(e.id);
    }
    if (next && e.start + e.dur > next.start - 0.02) e.dur = Math.max(0.12, next.start - 0.02 - e.start);
  }
}
function penEvent(id, label, anchor, off, dur, ds, opt) {
  const strokes = ds.map(d => mkPath(d, opt));
  STROKES[id] = strokes;
  const e = { id, label, anchor, off, dur, type: 'pen', strokes, color: opt.color, group: opt.group, start: anchor.time + off, scene: opt.scene ?? CUR, appear: !!opt.appear, noTip: !!opt.appear };
  if (ds.every(d => d !== null)) timeStrokes(strokes);
  EVENTS.push(e); return e;
}
function glyphEvent(id, label, anchor, off, dur, ch, cx, cy, h, opt) {
  ch = mapDigits(String(ch), opt.digits);
  if ([...ch].length > 1) {                // a whole number ("10", "0.6", "60%") as one pen event
    const n = numberPaths(ch, cx, cy, h, opt.key || id);
    NOM[id] = { x: cx - n.w / 2, y: cy - h / 2, w: n.w, h };
    return penEvent(id, label, anchor, off, dur, n.ds, { ...opt, width: opt.width || Math.max(9, h * 0.12) });
  }
  const gw = GLYPHS[ch] ? GLYPHS[ch].w * h : h;
  NOM[id] = { x: cx - gw / 2, y: cy - h / 2, w: gw, h };
  return penEvent(id, label, anchor, off, dur, glyphPaths(ch, cx, cy, h, opt.key || id), { ...opt, width: opt.width || Math.max(9, h * 0.12) });
}
function textRow(id, spec) {
  const ltr = spec.dir === 'ltr', row = document.createElement('div'); row.className = ltr ? 'row ltr' : 'row ar'; row.style.width = FW + 'px';
  row.style.top = (spec.top || 0) + 'px';
  if (spec.cx !== undefined) row.style.left = (spec.cx - FW / 2).toFixed(1) + 'px';
  const sp = document.createElement('span'); sp.id = id; sp.className = ltr ? 'w ltr ink' : 'w ar ink';
  if (spec.parts) spec.parts.forEach((q, k) => { const c = document.createElement('span'); c.id = `${id}.${k}`; c.textContent = q.text; if (q.color) c.style.color = color(q.color); sp.appendChild(c); });   // one word in coloured pieces (root letters, ending…)
  else sp.textContent = spec.text;
  if (spec.color) sp.style.color = color(spec.color);
  sp.style.fontSize = spec.size + 'px'; sp.dataset.sense = spec.group; sp.dataset.scene = CUR;
  if (spec.in_block === false) sp.dataset.block = '0';
  if (spec.size < T.minFontPx) throw new Error(`text "${id}" is ${spec.size} px, below the theme minimum ${T.minFontPx} px`);
  row.appendChild(sp); (SCENED ? SCENES[CUR].texts : $('texts')).appendChild(row);
  if (spec.near) placeNear(id, row, sp, spec.near);
  else if (flows(spec, 'top')) row.style.top = flowTop(spec, sp.offsetHeight).toFixed(1) + 'px';
  return sp;
}
// near: { of, side: right|left|below|above, fy, gap, frame: [ids] } — a label beside the thing it names: level with it, outside the
// frame (e.g. the whole drawing), flipped to the other side if it would leave the safe area, and pushed down past any label already there
const NEAR = {};
function placeNear(id, row, sp, n) {
  const ub = ids => { const bs = ids.map(i => NOM[i] || (document.getElementById(i) && box(document.getElementById(i)))).filter(Boolean);
    if (!bs.length) throw new Error(`"${id}": near.of "${n.of}" is not drawn before it`);
    const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y)); return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y }; };
  const T = ub([n.of]), F = ub(n.frame || [n.of]), w = sp.offsetWidth, h = sp.offsetHeight, g = n.gap ?? 36;
  const lo = (SAFE.left || 0) + (L.frame.margin || 60), hi = FW - (SAFE.right || 0) - (L.frame.margin || 60);
  let side = n.side || 'right', x, y;
  if (side === 'right' && F.x + F.w + g + w > hi) side = 'left';
  if (side === 'left' && F.x - g - w < lo) side = 'right';
  if (side === 'right' || side === 'left') { x = side === 'right' ? F.x + F.w + g : F.x - g - w; y = T.y + T.h * (n.fy ?? 0.5) - h / 2; }
  else { x = Math.min(hi - w, Math.max(lo, T.x + T.w / 2 - w / 2)); y = side === 'below' ? F.y + F.h + g : F.y - g - h; }
  const list = NEAR[CUR] = NEAR[CUR] || [], hit = q => x < q.x + q.w + 12 && q.x < x + w + 12 && y < q.y + q.h + 8 && q.y < y + h + 8;
  if (list.some(hit)) {                            // never on top of another label: the nearest free place, up or down
    const y0 = y; for (let d = 6; d < 600; d += 6) { y = y0 + d; if (!list.some(hit)) break; y = y0 - d; if (!list.some(hit)) break; } }
  list.push({ x, y, w, h });
  if (ROW && FLOW_ON) ROW.bottom = Math.max(ROW.bottom, y + h);   // the next row starts under the labels too
  row.style.top = y.toFixed(1) + 'px'; row.style.left = (x + w / 2 - FW / 2).toFixed(1) + 'px';
  sp.dataset.side = side;
}
function wipeEvent(id, label, anchor, off, dur, dir, spec) {
  const e = { id, label, anchor, off, dur, type: 'wipe', el: $(id), dir, color: color('ink'), group: spec.group, start: anchor.time + off, fade: spec.fade_out, centerInFrame: !!spec.center_in_frame, scene: CUR, appear: !!spec.appear, noTip: !!spec.appear };
  EVENTS.push(e); return e;
}
const TEXT_DEFAULTS = { title: { size: 66 }, subtitle: { size: 52 }, label: { size: 52 }, text: { size: 52 } };

// each tool turns one lesson event into one or more timed drawing events
const TOOLS = {
  title: ev => textTool(ev), subtitle: ev => textTool(ev), label: ev => textTool(ev), text: ev => textTool(ev),
  bar(ev) {
    BARS[ev.id] = { x: ev.x, y: ev.y, w: ev.w, h: ev.h, parts: ev.parts, cw: ev.w / ev.parts };
    const { x, y, w, h } = ev;
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur,
      [wobbly([[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y - 2]]], ev.amp ?? 2.5, ev.key || ev.id)],
      { color: color(ev.color || 'shape'), width: ev.width || 9, group: ev.group });
  },
  divider(ev) {
    const b = BARS[ev.bar], x = b.x + b.cw * ev.at;
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [wobbly([[[x, b.y], [x, b.y + b.h]]], ev.amp ?? 1.6, ev.key || ev.id)],
      { color: color(ev.color || 'shape'), width: ev.width || 8, group: ev.group });
  },
  shade(ev) {
    const b = BARS[ev.bar], x0 = b.x + b.cw * ev.part + 12, x1 = b.x + b.cw * (ev.part + ev.count) - 30;
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [wobbly([hatch(x0, x1, b.y + 12, b.y + b.h - 12, ev.step || 17, ev.slant ?? 18)], ev.amp ?? 1, ev.key || ev.id)],
      { color: color(ev.color || 'shape'), width: ev.width || 6, opacity: ev.opacity ?? 0.85, group: ev.group, layer: 'gShade' });
  },
  frame_parts(ev) {
    const b = BARS[ev.bar], l = b.x + b.cw * ev.part + ev.inset, r = b.x + b.cw * (ev.part + ev.count) - ev.right_inset, t = b.y + ev.inset, bo = b.y + b.h - ev.inset;
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [wobbly([[[l, t], [r, t], [r, bo], [l, bo], [l, t - 4]]], ev.amp ?? 1.6, ev.key || ev.id)],
      { color: color(ev.color || 'accent'), width: ev.width || 8, group: ev.group });
  },
  fraction(ev) {                                   // numerator, hand-drawn bar, denominator
    const a = anchorOf(ev.anchor), off = ev.offset || 0, c = color(ev.color || 'ink'), ids = ev.ids, o = { color: c, group: ev.group, digits: ev.digits };
    const half = ev.line_half ?? Math.max(58, ...[ev.num, ev.den].map(v => numberLayout(mapDigits(String(v), ev.digits), ev.h).w / 2 + 14));
    glyphEvent(ids.num, ev.label + ' numerator', a, off, 0.26, ev.num, ev.x, ev.num_y, ev.h, o);
    penEvent(ids.line, ev.label + ' line', a, off + 0.27, 0.16, [wobbly([[[ev.x - half, ev.line_y + 2], [ev.x + half, ev.line_y - 2]]], 2, ids.line)], { ...o, width: 10 });
    glyphEvent(ids.den, ev.label + ' denominator', a, off + 0.44, 0.28, ev.den, ev.x, ev.den_y, ev.h, o);
  },
  plus: ev => symbolTool(ev, '+'), equals: ev => symbolTool(ev, '='), digit: ev => symbolTool(ev, ev.char),
  circle(ev) {
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [loop(ev.x, ev.y, ev.rx, ev.ry, ev.key || ev.id)],
      { color: color(ev.color || 'shape'), width: ev.width || 7, group: ev.group });
  },
  arrow(ev) {                                      // from a label/element to an element; the tip stops `gap` px from its ink
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [null], { color: color(ev.color || 'shape'), width: ev.width || 6, group: ev.group });
    PENDING.push(() => {
      const P0 = pointOf(ev.from), P1 = pointOf(ev.to), w = ev.width || 6, tip = gapTip(P0, P1, inkBox(ev.to.of), (ev.gap ?? 12) + w / 2);
      ARROW_TIPS[ev.id] = { tip, target: ev.to.of, gap: ev.gap ?? 12 };
      setD(e.strokes[0], wobbly(arrowPolys(P0[0], P0[1], tip[0], tip[1], ev.head || 20), ev.amp ?? 1.2, ev.key || ev.id));
      timeStrokes(e.strokes);
    });
  },
  check(ev) {
    const s = ev.scale || 1, y = flows(ev, 'y') ? flowTop(ev, 100 * s) + 50 * s : ev.y, x = ev.x ?? FW / 2 - 53 * s;
    const P = [[0, 8], [36, 50], [106, -50]].map(([dx, dy]) => [x + dx * s, y + dy * s]);
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [wobbly([P], ev.amp ?? 2.5, ev.key || ev.id)],
      { color: color(ev.color || 'shape'), width: ev.width || 13, group: ev.group });
  },
  line(ev) {                                       // a written line with its label; the label must come first
    const lab = ev.label_text;
    textRow(lab.id, { ...lab, group: ev.group });
    const la = anchorOf(lab.anchor);
    wipeEvent(lab.id, lab.label, la, lab.offset || 0, lab.dur, 'rtl', lab);
    const items = ev.items.map(it => {
      const a = anchorOf(it.anchor);
      if (a.time + (it.offset || 0) <= la.time + (lab.offset || 0)) throw new Error(`line "${ev.id}": item "${it.id}" would appear before its label`);
      glyphEvent(it.id, it.label, a, it.offset || 0, it.dur, it.char, it.x, ev.y, it.h || ev.h, { color: color(it.color || 'ink'), group: ev.group, width: it.width, digits: it.digits ?? ev.digits });
      return it.id;
    });
    ORDER.push({ line: ev.id, label: lab.id, items });
  },

  // ---------- general maths tools ----------
  number(ev) {                                     // a whole number / decimal / percent ("12", "0.6", "60%"), left to right
    need(ev, ['id', 'text', 'h', 'group', 'anchor', 'dur']);
    const [x, y] = placeOf(ev);
    glyphEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, String(ev.text), x, y, ev.h,
      { color: color(ev.color || 'ink'), group: ev.group, width: ev.width, key: ev.key, digits: ev.digits });
  },
  number_line(ev) {                                // axis + ticks (one pen event), then optional labels (a second event)
    need(ev, ['id', 'w', 'group', 'anchor', 'dur']);
    const tk = ev.tick ?? 34, room = ev.headroom ?? 0, below = ev.labels ? tk * 0.75 + (ev.labels.h ?? 64) + 26 : tk * 0.75;
    const y = flows(ev, 'y') ? flowTop(ev, room + tk * 0.75 + below) + room + tk * 0.75 : ev.y, x = ev.x ?? (FW - ev.w) / 2, w = ev.w;
    if (y === undefined) throw new Error(`number_line "${ev.id}": missing y (or use the flow layout)`);
    const from = ev.from ?? 0, to = ev.to ?? 1, step = ev.step ?? 0.1, n = Math.round((to - from) / step);
    if (!(to > from) || n < 1 || n > 60 || Math.abs(from + n * step - to) > 1e-6) throw new Error(`number_line "${ev.id}": from/to/step must give 1..60 equal steps`);
    const xOf = v => { if (v < from - 1e-9 || v > to + 1e-9) throw new Error(`number_line "${ev.id}": ${v} is outside ${from}..${to}`); return x + (v - from) / (to - from) * w; };
    const tick = ev.tick ?? 34, ext = ev.ends ?? 40, key = ev.key || ev.id, c = color(ev.color || 'shape');
    LINES[ev.id] = { x, y, w, from, to, xOf, tick, end: x + w + ext };
    const ds = [wobbly([[[x - ext, y + 1], [x + w + ext, y - 1]]], ev.amp ?? 1.8, key)];
    if (ev.arrow !== false) { const e = x + w + ext; ds.push(wobbly([[[e - 22, y - 13], [e, y - 1], [e - 22, y + 11]]], 0.6, key + ':a')); }
    for (let i = 0; i <= n; i++) {
      const X = x + i * w / n, th = ev.major_every && i % ev.major_every === 0 ? tick * 1.5 : tick;
      ds.push(wobbly([[[X, y - th / 2], [X + 1, y + th / 2]]], 0.8, `${key}:t${i}`));
    }
    const a = anchorOf(ev.anchor), off = ev.offset || 0;
    penEvent(ev.id, ev.label, a, off, ev.dur, ds, { color: c, width: ev.width || 7, group: ev.group });
    const lb = ev.labels; if (!lb) return;
    const h = lb.h ?? 64, dy = lb.dy ?? tick * 0.75 + h / 2 + 22, lds = [];
    lb.values.forEach((v, i) => lds.push(...numberPaths(mapDigits(String(v), lb.digits ?? ev.digits), xOf(parseFloat(v)), y + dy, h, `${key}:l${i}`).ds));
    LINES[ev.id].labelY = y + dy;
    penEvent(lb.id || ev.id + 'Lab', lb.label || ev.label + ' labels', lb.anchor ? anchorOf(lb.anchor) : a, lb.anchor ? lb.offset || 0 : off + ev.dur + 0.05,
      lb.dur ?? 0.3 * lb.values.length, lds, { color: color(lb.color || 'ink'), width: lb.width || Math.max(9, h * 0.12), group: ev.group });
  },
  hop(ev) {                                        // an arc arrow above a number line, from one value to another, + optional number on top
    need(ev, ['id', 'line', 'from', 'to', 'group', 'anchor', 'dur']);
    const Ln = LINES[ev.line]; if (!Ln) throw new Error(`hop "${ev.id}": number_line "${ev.line}" must come first`);
    const xa = Ln.xOf(ev.from), xb = Ln.xOf(ev.to), H = ev.height ?? Math.min(150, 40 + Math.abs(xb - xa) * 0.3), base = Ln.y - (ev.lift ?? Ln.tick / 2 + 14);
    const pts = Array.from({ length: 49 }, (_, i) => [xa + (xb - xa) * i / 48, base - H * Math.sin(Math.PI * i / 48)]);
    const E = pts[48], A = Math.atan2(E[1] - pts[45][1], E[0] - pts[45][0]), hd = ev.head ?? 22, key = ev.key || ev.id, c = color(ev.color || 'accent');
    const head = wobbly([[[E[0] - hd * Math.cos(A - 0.5), E[1] - hd * Math.sin(A - 0.5)], E, [E[0] - hd * Math.cos(A + 0.5), E[1] - hd * Math.sin(A + 0.5)]]], 0.6, key + ':h');
    const a = anchorOf(ev.anchor), off = ev.offset || 0;
    penEvent(ev.id, ev.label, a, off, ev.dur, [smoothWobble(pts, ev.amp ?? 2, key), head], { color: c, width: ev.width || 7, group: ev.group });
    const tx = ev.text; if (!tx) return;
    const h = tx.h ?? 60;
    glyphEvent(tx.id || ev.id + 'Txt', tx.label || ev.label + ' number', tx.anchor ? anchorOf(tx.anchor) : a, tx.anchor ? tx.offset || 0 : off + ev.dur + 0.05,
      tx.dur ?? 0.25 * [...String(tx.text)].length, String(tx.text), (xa + xb) / 2 + (tx.dx || 0), base - H - (tx.dy ?? h / 2 + 24), h,
      { color: color(tx.color || ev.color || 'accent'), group: ev.group, digits: tx.digits ?? ev.digits });
  },
  pie(ev) {                                        // a hand circle cut into N equal parts (radii from the centre)
    need(ev, ['id', 'r', 'parts', 'group', 'anchor', 'dur']);
    if (!(Number.isInteger(ev.parts) && ev.parts >= 1 && ev.parts <= 24)) throw new Error(`pie "${ev.id}": parts must be 1..24`);
    const py = flows(ev, 'y') ? flowTop(ev, 2 * ev.r + 16) + ev.r + 8 : ev.y, px = ev.x ?? FW / 2;
    if (py === undefined) throw new Error(`pie "${ev.id}": missing y (or use the flow layout)`);
    const P = PIES[ev.id] = { x: px, y: py, r: ev.r, n: ev.parts, a0: (ev.start_deg ?? -90) * Math.PI / 180 }, key = ev.key || ev.id, ds = [ring(P.x, P.y, P.r, key)];
    if (P.n > 1) for (let i = 0; i < P.n; i++) {
      const t = P.a0 + i * 2 * Math.PI / P.n;
      ds.push(wobbly([[[P.x, P.y], [P.x + P.r * Math.cos(t), P.y + P.r * Math.sin(t)]]], ev.amp ?? 1.2, `${key}:r${i}`));
    }
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ds, { color: color(ev.color || 'shape'), width: ev.width || 8, group: ev.group });
  },
  pie_shade(ev) {                                  // hatch `count` parts of a pie starting at `part` (clockwise from start_deg)
    need(ev, ['id', 'pie', 'part', 'count', 'group', 'anchor', 'dur']);
    const P = PIES[ev.pie]; if (!P) throw new Error(`pie_shade "${ev.id}": pie "${ev.pie}" must come first`);
    if (ev.part < 0 || ev.part + ev.count > P.n) throw new Error(`pie_shade "${ev.id}": parts ${ev.part}..${ev.part + ev.count - 1} do not exist in a ${P.n}-part pie`);
    const ds = [];
    for (let k = ev.part; k < ev.part + ev.count; k++) ds.push(wobbly([hatchPoly(sectorPoly(P, k, ev.inset ?? 12), ev.step || 17, ev.slant ?? 14)], ev.amp ?? 1, `${ev.key || ev.id}:${k}`));
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ds,
      { color: color(ev.color || 'shape'), width: ev.width || 6, opacity: ev.opacity ?? 0.85, group: ev.group, layer: 'gShade' });
  },
  grid(ev) {                                       // area model: outer rectangle, then the column and row lines
    need(ev, ['id', 'w', 'h', 'rows', 'cols', 'group', 'anchor', 'dur']);
    if (!(ev.rows >= 1 && ev.cols >= 1 && ev.rows <= 20 && ev.cols <= 20)) throw new Error(`grid "${ev.id}": rows and cols must be 1..20`);
    const { w, h, rows, cols } = ev, y = flows(ev, 'y') ? flowTop(ev, h) : ev.y, x = ev.x ?? (FW - w) / 2;
    if (y === undefined) throw new Error(`grid "${ev.id}": missing y (or use the flow layout)`);
    const G = GRIDS[ev.id] = { x, y, w, h, rows, cols, cw: w / cols, ch: h / rows }, key = ev.key || ev.id;
    const ds = [wobbly([[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y - 2]]], ev.amp ?? 2.5, key)];
    for (let i = 1; i < cols; i++) ds.push(wobbly([[[x + i * G.cw, y], [x + i * G.cw, y + h]]], 1.4, `${key}:c${i}`));
    for (let i = 1; i < rows; i++) ds.push(wobbly([[[x, y + i * G.ch], [x + w, y + i * G.ch]]], 1.4, `${key}:r${i}`));
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ds, { color: color(ev.color || 'shape'), width: ev.width || 8, group: ev.group });
  },
  expr(ev) {                                       // a whole expression; each top-level term/operator is its own timed piece
    need(ev, ['id', 'text', 'group', 'anchor']);
    const h = ev.h ?? 100, items = parseExpr(String(ev.text)), Ls = items.map(n => layExpr(n, h, ev.digits)), offs = []; let W = 0;
    checkMath(ev, items);
    Ls.forEach((Lk, k) => { if (k) W += exprGap(items[k - 1], items[k], h); offs.push(W); W += Lk.w; });
    const up = Math.max(h / 2, ...Ls.map(Lk => Lk.up)), dn = Math.max(h / 2, ...Ls.map(Lk => Lk.dn));
    const y = flows(ev, 'y') ? flowTop(ev, up + dn) + up : ev.y, x = ev.x ?? FW / 2, al = ev.align || 'center';
    if (y === undefined) throw new Error(`expr "${ev.id}": missing y (or use the flow layout)`);
    // rows with the same `column` share one left edge, placed so the widest of them is centred at x
    const colW = ev.column && Math.max(...L.events.filter(o => o.tool === 'expr' && o.column === ev.column).map(o => layExpr({ k: 'seq', items: parseExpr(String(o.text)) }, o.h ?? 100, o.digits).w));
    const x0 = colW ? x - colW / 2 : al === 'left' ? x : al === 'right' ? x - W : x - W / 2, key = ev.key || ev.id, cues = ev.cues || [];
    let a = anchorOf(ev.anchor), off = ev.offset || 0;
    Ls.forEach((Lk, k) => {
      if (k && cues[k]) { a = anchorOf(cues[k]); off = (ev.cue_offsets && ev.cue_offsets[k]) || 0; }
      if (!Lk.marks.length) return;                // an invisible × (2√…, 4(…)) draws nothing
      const id = (ev.names && ev.names[k]) || `${ev.id}.${k}`, dur = (ev.durs && ev.durs[k]) ?? Math.min(1.2, 0.1 + 0.16 * Lk.marks.length);
      NOM[id] = { x: x0 + offs[k], y: y - Lk.up, w: Lk.w, h: Lk.up + Lk.dn }; (EXPR_PIECES[ev.id] = EXPR_PIECES[ev.id] || []).push(id);
      penEvent(id, `${ev.label || ev.id} [${k}]`, a, off, dur, Lk.marks.flatMap((m, j) => markPaths(m, x0 + offs[k], y, `${key}:${k}:${j}`)),
        { color: color((ev.colors && ev.colors[k]) || ev.color || 'ink'), width: ev.width || Math.max(9, h * 0.12), group: ev.group, appear: ev.appear });
      off += dur + 0.04;                           // a piece without its own cue follows the previous one
    });
  },
  column(ev) {                                     // column arithmetic (+ − ×) written digit by digit; the engine computes carries and borrows
    need(ev, ['id', 'op', 'a', 'b', 'group', 'anchor']);
    const op = { '+': '+', '-': '-', '−': '-', '×': '×', '*': '×' }[ev.op], A = String(ev.a), B = String(ev.b);
    if (!op) throw new Error(`column "${ev.id}": op must be + - or ×`);
    if (!/^\d{1,7}$/.test(A) || !/^\d{1,7}$/.test(B)) throw new Error(`column "${ev.id}": a and b must be whole numbers of 1..7 digits`);
    if (op === '-' && +A < +B) throw new Error(`column "${ev.id}": ${A} - ${B} would be negative`);
    const h = ev.h ?? 90, cw = 0.72 * h, sh = 0.42 * h, key = ev.key || ev.id, dig = ev.digits, ink = color(ev.color || 'ink'), acc = color(ev.mark_color || 'accent');
    const da = [...A].reverse().map(Number), db = [...B].reverse().map(Number), res = String(op === '+' ? +A + +B : op === '-' ? +A - +B : +A * +B);
    const multi = op === '×' && B.length > 1, parts = multi ? db.map((d, j) => String(+A * d) + (ev.zeros === false ? '' : '0'.repeat(j))) : [];
    const N = Math.max(A.length, B.length, res.length, ...parts.map(q => q.length));
    // rows, from the top of the block: carries/borrows, a, b, rule, result (or partial products, rule, sum)
    const yC = 0.28 * h, yA = yC + 0.8 * h, yB = yA + 1.2 * h, yR = yB + 0.68 * h, yP = j => yR + 0.72 * h + j * 1.2 * h;
    const yR2 = multi ? yP(parts.length - 1) + 0.68 * h : 0, ySum = multi ? yR2 + 0.72 * h : yR + 0.72 * h, H = ySum + 0.55 * h;
    const right = ev.sign_side === 'right', W = (N + 1) * cw, cx = ev.x ?? FW / 2, xR = cx + W / 2 - (right ? cw : 0);
    const top = flows(ev, 'y') ? flowTop(ev, H) : ev.y;
    if (top === undefined) throw new Error(`column "${ev.id}": missing y (top of the block) or use the flow layout`);
    const X = i => xR - (i + 0.5) * cw, xs = right ? xR + 0.6 * cw : X(N), Y = y => top + y;
    const g = (c, i, y, hh, k) => glyphPaths(mapDigits(c, dig), X(i), Y(y), hh, k);
    const row = (str, y, k, rtl) => { const cs = [...str].reverse(), ii = cs.map((_, i) => i); if (!rtl) ii.reverse(); return ii.flatMap(i => g(cs[i], i, y, h, `${k}:${i}`)); };
    const rule = (y, k) => [wobbly([[[Math.min(xs, X(N - 1)) - 0.45 * cw, Y(y) + 1.5], [Math.max(xs, X(0)) + 0.5 * cw, Y(y) - 1.5]]], 1.8, k)];
    const E = [];                                  // elements in teaching order: { k, ds, w, c, dur }
    const big = Math.max(9, h * 0.12), small = Math.max(6, sh * 0.13);
    E.push({ k: 'a', ds: row(A, yA, key + ':a'), w: big, c: ink, dur: 0.15 + 0.13 * A.length });
    E.push({ k: 'b', ds: row(B, yB, key + ':b'), w: big, c: ink, dur: 0.15 + 0.13 * B.length });
    E.push({ k: 'sign', ds: glyphPaths(op, xs, Y(yB), h * (SMALL[op] || 0.55), key + ':s'), w: big, c: ink, dur: 0.2 });
    E.push({ k: 'rule', ds: rule(yR, key + ':r'), w: 8, c: ink, dur: 0.25 });
    const digit = (i, y) => ({ k: `r${i}`, ds: g(res[res.length - 1 - i], i, y, h, `${key}:r${i}`), w: big, c: ink, dur: 0.28 });
    const note = (k, str, i) => ({ k, ds: numberPaths(mapDigits(str, dig), X(i), Y(yC), sh, `${key}:${k}`).ds, w: small, c: acc, dur: 0.12 + 0.1 * str.length });
    if (op === '+') {
      let c = 0;
      for (let i = 0; i < res.length; i++) {
        E.push(digit(i, yR + 0.72 * h));
        c = Math.floor(((da[i] || 0) + (db[i] || 0) + c) / 10);
        if (c && i + 1 < Math.max(A.length, B.length)) E.push(note(`k${i + 1}`, String(c), i + 1));
      }
    } else if (op === '-') {                       // borrow chains: every changed digit of a is crossed and its new value written above
      const bin = [0], bout = [], nv = [];
      for (let i = 0; i < A.length; i++) { const v = da[i] - bin[i]; bout[i] = v < (db[i] || 0) ? 1 : 0; bin[i + 1] = bout[i]; nv[i] = v + 10 * bout[i]; }
      const marked = new Set();
      for (let i = 0; i < res.length || i < A.length; i++) {
        if (bout[i] && !marked.has(i)) {
          let m = i; while (bout[m]) m++;
          for (let j = m; j >= i; j--) {
            marked.add(j);
            E.push({ k: `x${j}`, ds: [wobbly([[[X(j) - 0.28 * h, Y(yA) + 0.36 * h], [X(j) + 0.28 * h, Y(yA) - 0.36 * h]]], 0.8, `${key}:x${j}`)], w: small, c: acc, dur: 0.15 });
            E.push(note(`n${j}`, String(nv[j]), j));
          }
        }
        if (i < res.length) E.push(digit(i, yR + 0.72 * h));
      }
    } else if (!multi) {
      let c = 0;
      for (let i = 0; i < res.length; i++) {
        E.push(digit(i, yR + 0.72 * h));
        c = Math.floor(((da[i] ?? 0) * db[0] + c) / 10);
        if (c && i + 1 < A.length) E.push(note(`k${i + 1}`, String(c), i + 1));
      }
    } else {                                       // partial products (with place-holder zeros), a second rule, the sum
      parts.forEach((q, j) => E.push({ k: `p${j}`, ds: row(q, yP(j), `${key}:p${j}`, true), w: big, c: ink, dur: 0.15 + 0.15 * q.length }));
      E.push({ k: 'sign2', ds: glyphPaths('+', xs, Y(yP(parts.length - 1)), h * 0.55, key + ':s2'), w: big, c: ink, dur: 0.2 });
      E.push({ k: 'rule2', ds: rule(yR2, key + ':r2'), w: 8, c: ink, dur: 0.25 });
      for (let i = 0; i < res.length; i++) E.push(digit(i, ySum));
    }
    const cues = ev.cues || {}, durs = ev.durs || {}, unknown = Object.keys(cues).filter(k => !E.some(e => e.k === k));
    if (unknown.length) throw new Error(`column "${ev.id}": no step called ${unknown.join(', ')} (steps: ${E.map(e => e.k).join(' ')})`);
    let a = anchorOf(ev.anchor), off = ev.offset || 0;
    for (const el of E) {
      if (cues[el.k]) { a = anchorOf(cues[el.k]); off = (ev.cue_offsets && ev.cue_offsets[el.k]) || 0; }
      const dur = durs[el.k] ?? el.dur;
      penEvent(`${ev.id}.${el.k}`, `${ev.label || ev.id} ${el.k}`, a, off, dur, el.ds, { color: el.c, width: el.w, group: ev.group });
      off += dur + 0.05;                           // a step without its own cue follows the one before
    }
    COLUMNS[ev.id] = { steps: E.map(e => e.k), result: res };
  },
  scene(ev) {                                      // turn the page: the board so far fades out, later events start on a fresh one
    need(ev, ['id', 'anchor']);
    const a = anchorOf(ev.anchor);
    SCENES.push({ id: ev.id, start: a.time + (ev.offset || 0), fade: ev.fade ?? 0.35 });
    CUR = SCENES.length - 1; ROW = null; sceneBox(CUR);
  },
  card(ev) {                                       // a pen-drawn rounded frame around elements: the "hero" equation, or a side note
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [null], { color: color(ev.color || 'shape'), width: ev.width || 6, group: ev.group, opacity: ev.opacity, appear: ev.appear });
    PENDING.push(() => {
      // an expr id stands for all its pieces (p → p.0, p.1, …)
      const ids = [].concat(ev.of).flatMap(id => STROKES[id] || $(id) ? [id] : EXPR_PIECES[id] || (NOM[id] ? [id] : []));
      const bs = ids.map(id => STROKES[id] ? inkBox(id) : $(id) ? box($(id)) : NOM[id] || null);
      if (!bs.length || bs.includes(null)) throw new Error(`card "${ev.id}": unknown element in ${JSON.stringify(ev.of)}`);
      const pd = ev.pad ?? 26, l = Math.min(...bs.map(b => b.x)) - pd, t = Math.min(...bs.map(b => b.y)) - pd, r = Math.max(...bs.map(b => b.x + b.w)) + pd, b = Math.max(...bs.map(b => b.y + b.h)) + pd;
      const R = Math.min(ev.radius ?? 28, (b - t) / 2), pts = [], arc = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + i * Math.PI / 12; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); } };
      pts.push([(l + r) / 2, t]); arc(r - R, t + R, -Math.PI / 2); arc(r - R, b - R, 0); arc(l + R, b - R, Math.PI / 2); arc(l + R, t + R, Math.PI); pts.push([(l + r) / 2 + 30, t]);
      setD(e.strokes[0], smoothWobble(densify(pts, 12), ev.amp ?? 1.6, ev.key || ev.id)); timeStrokes(e.strokes);
    });
  },
  ray(ev) {                                        // an interval on a number line: a dot at its start (filled = included) and a thick arrow to the end of the line
    need(ev, ['id', 'line', 'from', 'group', 'anchor', 'dur']);
    const Ln = LINES[ev.line]; if (!Ln) throw new Error(`ray "${ev.id}": number_line "${ev.line}" must come first`);
    const xa = Ln.xOf(ev.from), y = Ln.y - (ev.lift ?? 34), key = ev.key || ev.id, r = ev.r ?? 9;
    const dot = 'M' + Array.from({ length: 25 }, (_, i) => f1(xa + r * Math.cos(i / 24 * 2 * Math.PI)) + ' ' + f1(y + r * Math.sin(i / 24 * 2 * Math.PI))).join('L');
    const ds = ev.dot_only ? [dot] : [dot, wobbly([[[xa + r, y], [ev.to !== undefined ? Ln.xOf(ev.to) : Ln.end - 6, y]]], 0.8, key + ':l')];
    if (!ev.dot_only && ev.to === undefined) { const e = Ln.end - 6; ds.push(wobbly([[[e - 20, y - 12], [e, y], [e - 20, y + 12]]], 0.5, key + ':a')); }
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ds, { color: color(ev.color || 'shape'), width: ev.width || (ev.dot_only ? 12 : 9), group: ev.group });
  },
  strike(ev) {                                     // cross a (deliberate) mistake out: two pen strokes over it, in the accent colour
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [null, null], { color: color(ev.color || 'accent'), width: ev.width || 9, group: ev.group });
    PENDING.push(() => {
      const b = unionBox(ev.of, `strike "${ev.id}"`), p = 10;
      setD(e.strokes[0], wobbly([[[b.x - p, b.y + b.h + p], [b.x + b.w + p, b.y - p]]], 1.5, ev.id + ':a'));
      setD(e.strokes[1], wobbly([[[b.x - p, b.y - p], [b.x + b.w + p, b.y + b.h + p]]], 1.5, ev.id + ':b'));
      timeStrokes(e.strokes);
    });
  },
  underline(ev) {                                  // a hand-drawn line under a word or an expression
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [null], { color: color(ev.color || 'accent'), width: ev.width || 7, group: ev.group });
    PENDING.push(() => {
      const b = unionBox(ev.of, `underline "${ev.id}"`), y = b.y + b.h + (ev.gap ?? 10);
      setD(e.strokes[0], smoothWobble(densify([[b.x - 6, y + 2], [b.x + b.w + 6, y - 2]], 10), 1.4, ev.id)); timeStrokes(e.strokes);
    });
  },
  countdown(ev) {                                  // «وقّف وجرّب»: a ring that empties second by second, a big clear number in it (3 · 2 · 1), then it fades
    need(ev, ['id', 'group', 'anchor']);
    const n = ev.from ?? 3, r = ev.r ?? 70, h = 2 * r + 20;
    const cy = flows(ev, 'y') ? flowTop(ev, h) + h / 2 : ev.y, cx = ev.x ?? FW / 2, a = anchorOf(ev.anchor), off = ev.offset || 0;
    if (cy === undefined) throw new Error(`countdown "${ev.id}": missing y (or use the flow layout)`);
    const col = color(ev.color || 'accent'), end = n + 0.1;
    const ringE = penEvent(ev.id, ev.label || 'countdown', a, off, 0.4, [ring(cx, cy, r, ev.id)], { color: col, width: 10, group: ev.group });
    // the time left: the paper colour draws over the ring round the clock, so the ring empties exactly in n seconds
    const arc = `M${f1(cx)} ${f1(cy - r)}` + Array.from({ length: 48 }, (_, k) => { const u = (k + 1) / 48 * 2 * Math.PI; return `L${f1(cx + r * Math.sin(u))} ${f1(cy - r * Math.cos(u))}`; }).join('');
    const drain = penEvent(`${ev.id}.time`, 'time left', a, off + 0.4, n - 0.3, [arc], { color: T.paper, width: 16, group: ev.group });
    const track = penEvent(`${ev.id}.track`, 'timer track', a, off, 0.4, [ring(cx, cy, r, ev.id + 't')], { color: col, width: 4, group: ev.group, opacity: 0.3 });
    for (const e of [ringE, drain, track]) { e.fade = { at: ringE.start + end, dur: 0.3 }; e.noTip = true; e.deco = true; e.timer = true; }   // a timer, not writing: exact seconds, never the pen
    const digits = ev.digits === 'ar' ? '٠١٢٣٤٥٦٧٨٩' : '0123456789', size = Math.round(r * 1.15);
    for (let k = 0; k < n; k++) {
      const id = `${ev.id}.${n - k}`, txt = String(n - k).replace(/\d/g, d => digits[d]);
      textRow(id, { text: txt, size: Math.max(size, T.minFontPx), top: cy - size * 0.95, cx, color: ev.color || 'accent', group: ev.group, dir: 'ltr' });
      const g = wipeEvent(id, `countdown ${n - k}`, a, off + 0.2 + k, 0.2, 'ltr', { appear: true });
      g.fade = { at: g.start + 0.8, dur: 0.15 }; g.deco = true;
    }
  },
  erase(ev) {                                      // «امسح»: an eraser sweeps over elements and they fade away (the teacher erases and writes again)
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [null], { color: T.paper, width: ev.width || 46, group: ev.group, opacity: 0.001 });
    e.erases = [].concat(ev.of);
    PENDING.push(() => {
      const b = unionBox(ev.of, `erase "${ev.id}"`), pts = [], rows = Math.max(1, Math.ceil(b.h / 40));
      for (let i = 0; i <= rows; i++) { const y = b.y + (b.h * i) / rows; pts.push(i % 2 ? [b.x + b.w + 10, y] : [b.x - 10, y]); }
      setD(e.strokes[0], 'M' + pts.map(q => f1(q[0]) + ' ' + f1(q[1])).join('L')); timeStrokes(e.strokes);
      for (const id of e.erases) for (const ee of EVENTS.filter(x => x.id === id || (EXPR_PIECES[id] || []).includes(x.id))) ee.fade = { at: e.start + ev.dur * 0.3, dur: ev.dur * 0.7 };
    });
  },
  pulse(ev) {                                      // a short emphasis on something already drawn: a soft swash that comes and goes
    need(ev, ['id', 'of', 'group', 'anchor']);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur ?? 0.35, [null], { color: color(ev.color || 'accent'), width: ev.width || 40, opacity: ev.opacity ?? 0.22, group: ev.group, layer: 'gShade', appear: true });
    e.fade = { at: e.start + (ev.hold ?? 1.4), dur: 0.35 }; e.pulse = true;
    PENDING.push(() => {
      const b = unionBox(ev.of, `pulse "${ev.id}"`), y = b.y + b.h * 0.6;
      setD(e.strokes[0], wobbly([[[b.x - 10, y + 4], [b.x + b.w + 10, y - 4]]], 1.5, ev.id)); timeStrokes(e.strokes);
    });
  },
  highlight(ev) {                                  // a translucent marker swash behind one or more drawn elements
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [null],
      { color: color(ev.color || 'accent'), width: ev.width || 44, opacity: ev.opacity ?? 0.3, group: ev.group, layer: 'gShade' });
    PENDING.push(() => {
      const bs = [].concat(ev.of).flatMap(id => STROKES[id] || $(id) ? [id] : EXPR_PIECES[id] || [id]).map(id => STROKES[id] ? inkBox(id) : $(id) ? box($(id)) : null);   // an expr id = all its pieces
      if (!bs.length || bs.includes(null)) throw new Error(`highlight "${ev.id}": unknown element in ${JSON.stringify(ev.of)}`);
      const l = Math.min(...bs.map(b => b.x)) - (ev.pad ?? 12), r = Math.max(...bs.map(b => b.x + b.w)) + (ev.pad ?? 12);
      const t = Math.min(...bs.map(b => b.y)), b = Math.max(...bs.map(b => b.y + b.h)), y = t + (b - t) * (ev.fy ?? 0.62);
      setD(e.strokes[0], wobbly([[[l, y + 5], [r, y - 5]]], ev.amp ?? 2, ev.key || ev.id));
      timeStrokes(e.strokes);
    });
  },
  badge(ev) {                                      // the subject at the top of the video: a pen-drawn pill with its name (frame coordinates, every board)
    need(ev, ['id', 'text', 'group', 'anchor', 'dur']);
    const size = ev.size ?? 58, cy = ev.y ?? SAFE.top + 50, cx = ev.x ?? FW / 2, c = color(ev.color || 'shape');
    if (!$('badgeBox')) { const d = document.createElement('div'); d.id = 'badgeBox'; Object.assign(d.style, { position: 'absolute', left: '0px', top: '0px' }); board.insertBefore(d, $('ov'));
      const g = document.createElementNS(NS, 'g'); g.id = 'gBadge'; g.setAttribute('filter', 'url(#inkStroke)'); $('ov').insertBefore(g, $('gMark')); }
    const row = document.createElement('div'), ltr = ev.dir === 'ltr'; row.className = ltr ? 'row ltr' : 'row ar'; row.style.width = FW + 'px'; row.style.left = (cx - FW / 2).toFixed(1) + 'px';
    const sp = document.createElement('span'); sp.id = ev.id + 'Txt'; sp.className = (ltr ? 'w ltr' : 'w ar') + ' ink'; sp.textContent = ev.text; sp.style.fontSize = size + 'px';
    sp.style.color = color(ev.text_color || 'ink'); sp.dataset.sense = ev.group; sp.dataset.scene = 'g'; sp.dataset.block = '0';
    row.appendChild(sp); $('badgeBox').appendChild(row);
    const w = sp.offsetWidth, hh = size * 0.78, r = hh, x0 = cx - w / 2 - r * 0.7, x1 = cx + w / 2 + r * 0.7, pts = [];
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI * i / 12; pts.push([x1 + r * 0.6 * Math.cos(a), cy + r * Math.sin(a)]); }
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + Math.PI * i / 12; pts.push([x0 + r * 0.6 * Math.cos(a), cy + r * Math.sin(a)]); }
    pts.unshift([cx, cy - r]); pts.push([cx + r * 0.4, cy - r]);
    const a = anchorOf(ev.anchor), off = ev.offset || 0;
    const e = penEvent(ev.id, ev.label, a, off, ev.dur * 0.6, [smoothWobble(densify(pts, 10), 1.5, ev.key || ev.id)], { color: c, width: ev.width || 7, group: ev.group, layer: 'gBadge', scene: 'g', inBlock: false });
    const t = wipeEvent(sp.id, ev.label + ' text', a, off + ev.dur * 0.55, ev.dur * 0.45, ltr ? 'ltr' : 'rtl', {}); t.scene = 'g';
    if (L.frame.pen) { e.noTip = true; t.noTip = true; }   // the badge is decoration: it appears without taking the pen
    BADGES.push({ row, top: cy - sp.offsetHeight / 2, pen: e });
  },
  sketch(ev) {                                     // a pen drawing from SVG path data (absolute M L C Q Z only), scaled and placed; parts can share a frame
    need(ev, ['id', 'paths', 'group', 'anchor', 'dur']);
    let F = ev.frame_of ? SKETCHES[ev.frame_of] : { x: ev.x, y: ev.y, s: ev.scale ?? 1 };
    if (!ev.frame_of && ev.box && flows(ev, 'y')) {    // flow: box = the raw extent of every part drawn in this frame {x, y, w, h}
      const s = ev.scale ?? 1, top = flowTop(ev, ev.box.h * s); F = { x: (ev.cx ?? FW / 2) - (ev.box.x + ev.box.w / 2) * s, y: top - ev.box.y * s, s }; }
    if (!F || F.x === undefined || F.y === undefined) throw new Error(`sketch "${ev.id}": give x, y (top-left) or frame_of an earlier sketch`);
    SKETCHES[ev.id] = F;
    let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
    const ds = [].concat(ev.paths).map(d => {
      if (/[^MLCQZ0-9.\s,\-]/.test(d)) throw new Error(`sketch "${ev.id}": only absolute M L C Q Z commands are allowed`);
      let k = 0;
      return d.replace(/-?\d*\.?\d+/g, v => {
        const n = +v, isX = k++ % 2 === 0, o = isX ? F.x + n * F.s : F.y + n * F.s;
        if (isX) { l = Math.min(l, o); r = Math.max(r, o); } else { t = Math.min(t, o); b = Math.max(b, o); }
        return f1(o);
      });
    });
    NOM[ev.id] = { x: l, y: t, w: r - l, h: b - t }; SKETCH_D[ev.id] = ds;
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ds,
      { color: color(ev.color || 'shape'), width: ev.width || 7, group: ev.group, opacity: ev.opacity, layer: ev.layer === 'shade' ? 'gShade' : 'gLine' });
  },
  wash(ev) {                                       // watercolour: a soft colour fill that blooms from the middle of a sketch or pie parts
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    let ds;
    if (SKETCH_D[ev.of]) ds = SKETCH_D[ev.of];
    else if (PIES[ev.of]) { const P = PIES[ev.of], k0 = ev.part ?? 0, n = ev.count ?? P.n;
      ds = Array.from({ length: n }, (_, j) => 'M' + sectorPoly(P, k0 + j, ev.inset ?? 4).map(q => f1(q[0]) + ' ' + f1(q[1])).join('L') + 'Z'); }
    else throw new Error(`wash "${ev.id}": "${ev.of}" is not a sketch or a pie defined earlier`);
    const b = NOM[ev.of] || { x: PIES[ev.of].x - PIES[ev.of].r, y: PIES[ev.of].y - PIES[ev.of].r, w: 2 * PIES[ev.of].r, h: 2 * PIES[ev.of].r };
    const clip = document.createElementNS(NS, 'clipPath'), circ = document.createElementNS(NS, 'circle'), cid = 'wc_' + ev.id;
    clip.id = cid; clip.setAttribute('clipPathUnits', 'userSpaceOnUse'); circ.setAttribute('cx', f1(b.x + b.w / 2)); circ.setAttribute('cy', f1(b.y + b.h / 2)); circ.setAttribute('r', '0');
    clip.appendChild(circ); $('ov').querySelector('defs').appendChild(clip);
    const els = ds.map(d => { const q = document.createElementNS(NS, 'path');
      for (const [k, v] of Object.entries({ d, fill: color(ev.color || 'shape'), 'fill-opacity': ev.opacity ?? 0.32, stroke: 'none', 'stroke-width': 0, 'clip-path': `url(#${cid})`, visibility: 'hidden' })) q.setAttribute(k, v);
      q.dataset.sense = ev.group; q.dataset.scene = CUR; $(layerOf('gShade')).appendChild(q); return q; });
    const a = anchorOf(ev.anchor);
    EVENTS.push({ id: ev.id, label: ev.label, anchor: a, off: ev.offset || 0, dur: ev.dur, type: 'wash', start: a.time + (ev.offset || 0), color: color(ev.color || 'shape'), scene: CUR,
      els, circ, R: Math.hypot(b.w, b.h) / 2 + 4, bb: b });
  },
  sparkle(ev) {                                    // a little celebration: short pen strokes burst around an element, then fade
    need(ev, ['id', 'of', 'group', 'anchor', 'dur']);
    const n = ev.count ?? 10, e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, Array(n).fill(null),
      { color: color(ev.color || 'accent'), width: ev.width || 7, group: ev.group });
    e.fade = { at: e.start + ev.dur + (ev.hold ?? 0.7), dur: 0.4 };
    if (L.frame.pen) { e.noTip = true; e.deco = true; }   // a celebration, not writing: no pen
    PENDING.push(() => {
      const b = STROKES[ev.of] ? inkBox(ev.of) : box($(ev.of)), cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 + (ev.gap ?? 26), ry = b.h / 2 + (ev.gap ?? 26), r = rngFor(ev.key || ev.id);
      e.strokes.forEach((st, k) => {
        const a = -Math.PI / 2 + k * 2 * Math.PI / n + (r() - 0.5) * 0.25, L = 24 + r() * 18, ux = Math.cos(a), uy = Math.sin(a);
        setD(st, wobbly([[[cx + rx * ux, cy + ry * uy], [cx + (rx + L) * ux, cy + (ry + L) * uy]]], 0.5, `${ev.id}:${k}`));
      });
      timeStrokes(e.strokes);
    });
  },
  voice_wave(ev) {                                 // an abstract speaker (no face): a pen-drawn ring whose bars move with the voice
    need(ev, ['id', 'x', 'y', 'group', 'anchor', 'dur']);
    const size = ev.size ?? 150, r = size / 2, key = ev.key || ev.id, n = ev.bars ?? 5;
    const el = (tag, at) => { const q = document.createElementNS(NS, tag); for (const a in at) q.setAttribute(a, at[a]); return q; };
    const g = el('g', { id: 'gV_' + ev.id }), gs = el('g', { id: 'gVs_' + ev.id, filter: 'url(#inkStroke)' }); $('ov').insertBefore(g, $('gMark'));
    g.appendChild(gs);
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [ring(ev.x, ev.y, r, key)],
      { color: color(ev.color || 'shape'), width: ev.width || Math.max(6, size * 0.055), group: ev.group, layer: gs.id, scene: 'g', inBlock: false });
    const bars = el('g', { opacity: 0 }), rng = rngFor(key + ':bars'), gap = size * 0.13, w = size * 0.075;
    const list = Array.from({ length: n }, (_, i) => {
      const x = ev.x + (i - (n - 1) / 2) * gap, line = el('line', { x1: f1(x), x2: f1(x), stroke: color(i === (n - 1) / 2 ? ev.accent || 'accent' : ev.bar_color || 'shape'), 'stroke-width': f1(w), 'stroke-linecap': 'round' });
      bars.appendChild(line);
      return { line, x, weight: 1 - Math.abs(i - (n - 1) / 2) / n * 0.9, f: 3 + rng() * 4, ph: rng() * 6.283 };
    });
    g.appendChild(bars);
    WAVES.push({ e, g, bars, list, y: ev.y, base: size * 0.06, amp: size * 0.3 });
    if (L.frame.pen) e.noTip = true;
  },
  mascot(ev) {                                     // an owl drawn by the pen; then it blinks, looks at what is being drawn and talks with the voice
    need(ev, ['id', 'x', 'y', 'group', 'anchor', 'dur']);
    const k = (ev.size ?? 200) / 200, P = (x, y) => [ev.x + x * k, ev.y + y * k], key = ev.key || ev.id;
    const quad = (a, b, c) => Array.from({ length: 17 }, (_, i) => { const u = i / 16, v = 1 - u; return [0, 1].map(j => v * v * a[j] + 2 * u * v * b[j] + u * u * c[j]); });
    const el = (tag, at) => { const n = document.createElementNS(NS, tag); for (const a in at) n.setAttribute(a, at[a]); return n; };
    // only the pen strokes sit under the ink filter; the fill and the face change every frame and stay outside it
    const g = el('g', { id: 'gM_' + ev.id }), gs = el('g', { id: 'gMs_' + ev.id, filter: 'url(#inkStroke)' }); $('ov').insertBefore(g, $('gMark'));
    const [bx, by] = P(0, 10), fill = el('ellipse', { cx: bx, cy: by, rx: 80 * k, ry: 94 * k, fill: T.paper, opacity: 0 }); g.appendChild(fill); g.appendChild(gs);
    const ds = [ring(bx, by, 80 * k, key, 94 * k),
      wobbly([[P(-46, -70), P(-60, -108), P(-22, -82)]], 1, key + ':tl'), wobbly([[P(46, -70), P(60, -108), P(22, -82)]], 1, key + ':tr'),
      smoothWobble(quad(P(-66, -6), P(-104, 40), P(-52, 82)), 1.5, key + ':wl'), smoothWobble(quad(P(66, -6), P(104, 40), P(52, 82)), 1.5, key + ':wr'),
      ...[[-20, 36], [20, 36], [0, 60]].map(([x, y], i) => smoothWobble(quad(P(x - 12, y), P(x, y + 12), P(x + 12, y)), 0.6, `${key}:f${i}`)),
      ...[-26, 26].map((x, i) => wobbly([[P(x - 12, 112), P(x, 102), P(x + 12, 112)]], 0.6, `${key}:t${i}`))];
    const e = penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ds, { color: color(ev.color || 'ink'), width: ev.width || 7 * Math.max(0.8, k), group: ev.group, layer: gs.id, scene: 'g' });
    const face = el('g', { opacity: 0 }); g.appendChild(face);
    const eyes = [-32, 32].map(x => { const [cx, cy] = P(x, -30), r = 27 * k;
      face.appendChild(el('circle', { cx, cy, r, fill: T.paper, stroke: T.ink, 'stroke-width': 6 * k }));
      const pupil = el('g', {}); pupil.appendChild(el('circle', { cx, cy, r: 11 * k, fill: T.ink })); pupil.appendChild(el('circle', { cx: cx - 3.5 * k, cy: cy - 4 * k, r: 3.5 * k, fill: T.paper }));
      const lid = el('path', { d: `M${f1(cx - r)} ${f1(cy)}Q${f1(cx)} ${f1(cy + r * 0.7)} ${f1(cx + r)} ${f1(cy)}`, fill: 'none', stroke: T.ink, 'stroke-width': 6 * k, 'stroke-linecap': 'round', visibility: 'hidden' });
      face.appendChild(pupil); face.appendChild(lid); return { cx, cy, pupil, lid }; });
    const ac = color(ev.beak || 'accent'), [mx, my] = P(0, 0);
    face.appendChild(el('path', { d: `M${f1(mx - 13 * k)} ${f1(my - 6 * k)}L${f1(mx + 13 * k)} ${f1(my - 6 * k)}L${f1(mx)} ${f1(my + 10 * k)}Z`, fill: ac, stroke: ac, 'stroke-width': 3 * k, 'stroke-linejoin': 'round' }));
    const lower = el('path', { fill: ac, stroke: ac, 'stroke-width': 3 * k, 'stroke-linejoin': 'round' }); face.insertBefore(lower, face.lastChild);
    const r = rngFor(key + ':blink'), blinks = []; for (let t = 1.2 + r() * 2; t < 600; t += 2.4 + r() * 2.4) blinks.push(t);
    MASCOTS.push({ e, fill, face, eyes, lower, blinks, k, mouth: [mx, my] });
  },
  grid_shade(ev) {                                 // hatch a block of cells: from (row, col), `rows` x `cols` cells
    need(ev, ['id', 'grid', 'row', 'col', 'group', 'anchor', 'dur']);
    const G = GRIDS[ev.grid]; if (!G) throw new Error(`grid_shade "${ev.id}": grid "${ev.grid}" must come first`);
    const nr = ev.rows || 1, nc = ev.cols || 1, ins = ev.inset ?? 10;
    if (ev.row < 0 || ev.col < 0 || ev.row + nr > G.rows || ev.col + nc > G.cols) throw new Error(`grid_shade "${ev.id}": cells outside the grid`);
    const l = G.x + ev.col * G.cw + ins, r = G.x + (ev.col + nc) * G.cw - ins, t = G.y + ev.row * G.ch + ins, b = G.y + (ev.row + nr) * G.ch - ins;
    penEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, [wobbly([hatchPoly([[l, t], [r, t], [r, b], [l, b]], ev.step || 17, ev.slant ?? 18)], ev.amp ?? 1, ev.key || ev.id)],
      { color: color(ev.color || 'shape'), width: ev.width || 6, opacity: ev.opacity ?? 0.85, group: ev.group, layer: 'gShade' });
  },
};
// the drawn box of one or more elements (an expr id stands for all its pieces)
function unionBox(of, who) {
  const ids = [].concat(of).flatMap(id => STROKES[id] || $(id) ? [id] : EXPR_PIECES[id] || [id]);
  const bs = ids.map(id => STROKES[id] ? inkBox(id) : $(id) ? box($(id)) : null);
  if (!bs.length || bs.includes(null)) throw new Error(`${who}: unknown element in ${JSON.stringify(of)}`);
  const l = Math.min(...bs.map(b => b.x)), t = Math.min(...bs.map(b => b.y)), r = Math.max(...bs.map(b => b.x + b.w)), bo = Math.max(...bs.map(b => b.y + b.h));
  return { x: l, y: t, w: r - l, h: bo - t };
}
const BARS = {}, ARROW_TIPS = {}, LINES = {}, PIES = {}, GRIDS = {}, MASCOTS = [], WAVES = [], LOOK = [], COLUMNS = {}, BADGES = [], SKETCHES = {}, SKETCH_D = {}, EXPR_PIECES = {}, TRIMMED = [];
function need(ev, keys) {
  const miss = keys.filter(k => ev[k] === undefined);
  if (miss.length) throw new Error(`${ev.tool} "${ev.id}": missing ${miss.join(', ')}`);
}
function placeOf(ev) {                           // x, y given directly, or "at" a number-line value, a grid cell/edge or a pie centre
  const a = ev.at; if (!a) { need(ev, ['x', 'y']); return [ev.x, ev.y]; }
  let p;
  if (a.line) { const Ln = LINES[a.line]; if (!Ln) throw new Error(`"${ev.id}": number_line "${a.line}" must come first`);
    p = [Ln.xOf(a.value), Ln.labelY ?? Ln.y + Ln.tick * 0.75 + ev.h / 2 + 22]; }
  else if (a.grid) { const G = GRIDS[a.grid]; if (!G) throw new Error(`"${ev.id}": grid "${a.grid}" must come first`);
    p = [a.col === undefined ? G.x - (a.gap ?? 60) : G.x + (a.col + (a.cols || 1) / 2) * G.cw, a.row === undefined ? G.y - (a.gap ?? 60) : G.y + (a.row + (a.rows || 1) / 2) * G.ch]; }
  else if (a.pie) { const P = PIES[a.pie]; if (!P) throw new Error(`"${ev.id}": pie "${a.pie}" must come first`); p = [P.x, P.y]; }
  else throw new Error(`"${ev.id}": "at" needs line, grid or pie`);
  return [p[0] + (a.dx || 0), p[1] + (a.dy || 0)];
}
function textTool(ev) {
  const spec = { ...TEXT_DEFAULTS[ev.tool], ...ev };
  textRow(ev.id, spec);
  wipeEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, spec.dir === 'ltr' ? 'ltr' : 'rtl', spec);
}
function symbolTool(ev, ch) {
  glyphEvent(ev.id, ev.label, anchorOf(ev.anchor), ev.offset || 0, ev.dur, ch, ev.x, ev.y, ev.h, { color: color(ev.color || 'ink'), group: ev.group, width: ev.width, key: ev.key });
}
function pointOf(p) {
  const b = NOM[p.of] || (document.getElementById(p.of) && box(document.getElementById(p.of)));
  if (!b) throw new Error(`arrow point: unknown element "${p.of}"`);
  return [b.x + (p.fx ?? 0.5) * b.w + (p.dx || 0), b.y + (p.fy ?? 0.5) * b.h + (p.dy || 0)];
}
function rectDist([x, y], b) { const dx = Math.max(b.x - x, 0, x - (b.x + b.w)), dy = Math.max(b.y - y, 0, y - (b.y + b.h)); return Math.hypot(dx, dy); }
function gapTip(P0, P1, b, G) {                  // first point on the ray P0→P1 that is exactly G px from the target box
  const at = u => [P0[0] + (P1[0] - P0[0]) * u, P0[1] + (P1[1] - P0[1]) * u];
  if (rectDist(P0, b) <= G) throw new Error('arrow starts inside the gap zone of its target');
  let lo = 0, hi = null;
  for (let u = 0; u <= 4; u += 0.002) { if (rectDist(at(u), b) <= G) { hi = u; break; } lo = u; }
  if (hi === null) throw new Error('arrow ray never reaches its target');
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (rectDist(at(m), b) <= G) hi = m; else lo = m; }
  return at(lo);
}

function build() {
  if (SCENED) sceneBox(0);
  for (const ev of L.events) {
    const tool = TOOLS[ev.tool]; if (!tool) throw new Error(`unknown tool "${ev.tool}" (have: ${Object.keys(TOOLS).join(', ')})`);
    tool(ev);
  }
  PENDING.forEach(f => f());
  autoTrim(); penPlan(); autoTrim(); idleFill();
  // fixed layout: centre the final block (everything except in_block:false) once; it never moves afterwards
  let top = 1e9, bot = -1e9;
  for (const el of document.querySelectorAll('[data-sense]')) {
    if (el.dataset.block === '0') continue;
    if (el.tagName === 'path') { const q = el.getBBox(), pad = parseFloat(el.getAttribute('stroke-width')) / 2; top = Math.min(top, q.y - pad); bot = Math.max(bot, q.y + q.height + pad); }
    else { const b = box(el); top = Math.min(top, b.y); bot = Math.max(bot, b.y + b.h); }
  }
  buildCaptions();
  DY = SCENED ? 0 : placeBlock(top, bot, 'the board');
  BLOCK = { top: top + DY, bottom: bot + DY };
  if (SCENED) centreScenes();
  EVENTS.forEach(e => { e.dy = SCENED && e.scene !== 'g' ? SCENES[e.scene].dy : 0; e.sc = SCENED && e.scene !== 'g' ? SCENES[e.scene] : null; });
  const toScreen = (e, x, y) => e.sc ? e.sc.map(x, y) : [x, y + e.dy];
  EVENTS.forEach(e => { e.at = (x, y) => toScreen(e, x, y); });
  for (const v of WAVES) { v.g.setAttribute('transform', `translate(0 ${-DY})`); v.e.dy = -DY; }   // frame coordinates too
  if (BADGES.length) {                             // badges sit in frame coordinates: undo the block shift
    $('gBadge').setAttribute('transform', `translate(0 ${-DY})`);
    for (const B of BADGES) { B.row.style.top = (B.top - DY).toFixed(1) + 'px'; B.pen.dy = -DY; }
  }
  for (const e of EVENTS) {
    if (e.type !== 'wipe') continue;
    if (e.centerInFrame) e.el.parentElement.style.top = (FHt / 2 - DY - e.dy - e.el.offsetHeight / 2).toFixed(1) + 'px';
    e.b = box(e.el); e.w = e.el.offsetWidth;
  }
  EVENTS.forEach(e => { e.end = e.start + e.dur; });
  const own = new Set([...MASCOTS, ...WAVES].map(m => m.e));
  for (const e of [...EVENTS].sort((a, b) => a.start - b.start)) {
    if (own.has(e)) continue;
    let b = e.b || e.bb;
    if (!b) { const bs = e.strokes.map(s => s.el.getBBox()), x0 = Math.min(...bs.map(q => q.x)), y0 = Math.min(...bs.map(q => q.y));
      b = { x: x0, y: y0, w: Math.max(...bs.map(q => q.x + q.width)) - x0, h: Math.max(...bs.map(q => q.y + q.height)) - y0 }; }
    LOOK.push({ start: e.start, c: e.b ? [b.x + b.w / 2, b.y + b.h / 2] : e.at(b.x + b.w / 2, b.y + b.h / 2) });
  }
}
function centreScenes() {                         // each scene's block centred once; events may not cross a page turn
  DY = 0; let worst = null;
  SCENES.forEach((S, k) => {
    let top = 1e9, bot = -1e9, lft = 1e9, rgt = -1e9;
    for (const el of document.querySelectorAll(`[data-sense][data-scene="${k}"]`)) {
      if (el.dataset.block === '0') continue;
      if (el.tagName === 'path') { const q = el.getBBox(), pad = parseFloat(el.getAttribute('stroke-width')) / 2; top = Math.min(top, q.y - pad); bot = Math.max(bot, q.y + q.height + pad); lft = Math.min(lft, q.x - pad); rgt = Math.max(rgt, q.x + q.width + pad); }
      else { const b = box(el), sp = el.getBoundingClientRect(); top = Math.min(top, b.y); bot = Math.max(bot, b.y + b.h); lft = Math.min(lft, b.x); rgt = Math.max(rgt, b.x + b.w); }
    }
    S.k = 1; S.dy = 0; S.pivot = 0;
    if (top <= bot) {
      const [rT, rB] = region(), avail = rB - rT, need = bot - top, fit = L.frame.fit;
      if (fit && need > avail + 0.5) {
        const sizes = [...S.texts.querySelectorAll('span')].map(e => parseFloat(e.style.fontSize)).filter(Boolean);
        const floor = Math.max(fit.min_scale ?? 0.8, sizes.length ? T.minFontPx / Math.min(...sizes) : 0);
        if (avail / need < floor) throw new Error(`BOARD_TOO_TALL board ${k + 1} (${S.id}): ${need.toFixed(0)} px for ${avail.toFixed(0)} px (scale ${(avail / need).toFixed(2)} < ${floor.toFixed(2)})`);
        S.k = avail / need;
      } else if (fit && fit.max_scale > 1) {         // a small board grows to fill its space (but stays inside the safe width)
        const X = FW / 2, wk = Math.min((X - SAFE.left - 6) / Math.max(1, X - lft), (FW - SAFE.right - 6 - X) / Math.max(1, rgt - X));
        S.k = Math.max(1, Math.min(fit.max_scale, (avail - 2) / need, wk));
      }
      const mid = (rT + rB) / 2, c = (top + bot) / 2;
      if (S.k === 1) S.dy = placeBlock(top, bot, `board ${S.id}`); else { S.pivot = c; S.dy = mid - c; }
    }
    const X = FW / 2, c0 = S.pivot;                 // local → screen: x' = X + k (x − X), y' = c0 + dy + k (y − c0)
    S.map = (x, y) => [X + S.k * (x - X), c0 + S.dy + S.k * (y - c0)];
    const tf = S.k === 1 ? `translate(0 ${S.dy})` : `translate(${X} ${c0 + S.dy}) scale(${S.k.toFixed(4)}) translate(${-X} ${-c0})`;
    S.g.setAttribute('transform', tf);
    S.texts.style.transformOrigin = '0 0';
    S.texts.style.transform = S.k === 1 ? `translateY(${S.dy}px)` : `translate(${X}px, ${c0 + S.dy}px) scale(${S.k.toFixed(4)}) translate(${-X}px, ${-c0}px)`;
    if (top > bot) return;
    S.block = { top: S.map(0, top)[1], bottom: S.map(0, bot)[1] };
    const mid = region().reduce((a, b) => a + b) / 2;
    if (!worst || Math.abs((S.block.top + S.block.bottom) / 2 - mid) > Math.abs((worst.top + worst.bottom) / 2 - mid)) worst = S.block;
  });
  BLOCK = worst;
  for (const e of EVENTS) {
    if (e.scene === 'g') continue;
    const S = SCENES[e.scene], next = SCENES[e.scene + 1];
    if (L.frame.auto_trim) continue;              // handled by autoTrim()
    if (e.scene > 0 && e.start < S.start + S.fade - 1e-9) throw new Error(`"${e.id}" starts before the page turn to ${S.id} has finished`);
    if (next && e.start + e.dur > next.start + 1e-9) throw new Error(`"${e.id}" is still drawing when ${next.id} turns the page`);
  }
}
let CAPS = null;
function buildCaptions() {                         // lesson "captions": { size, top, dir, progress } — under the badge, frame coordinates, outside the board
  const C = L.captions; if (!C) return;
  const box0 = document.createElement('div'); box0.id = 'caps'; Object.assign(box0.style, { position: 'absolute', left: '0px', top: '0px', width: FW + 'px', height: FHt + 'px' });
  stage.appendChild(box0);
  const size = C.size ?? 50, top = C.top ?? SAFE.top + 130, ltr = C.dir === 'ltr', rows = [];
  SEGS.forEach((sg, k) => {
    const row = document.createElement('div'); row.className = ltr ? 'ltr' : 'ar';
    Object.assign(row.style, { position: 'absolute', left: (SAFE.left + 40) + 'px', width: (FW - SAFE.left - SAFE.right - 80) + 'px', top: top + 'px', textAlign: 'center', fontSize: size + 'px', fontWeight: 700, lineHeight: '1.5', whiteSpace: 'normal', visibility: 'hidden' });
    const band = document.createElement('span');
    Object.assign(band.style, { background: T.paper, borderRadius: '22px', padding: '4px 16px', boxDecorationBreak: 'clone', webkitBoxDecorationBreak: 'clone', boxShadow: `0 0 0 3px ${color('shape')}33` });
    band.dataset.sense = 'captions'; band.dataset.block = '0'; band.dataset.scene = 'g';
    const words = sg.text.split(/\s+/).filter(Boolean).map((w, i) => { const sp = document.createElement('span'); sp.textContent = w; band.appendChild(sp); band.appendChild(document.createTextNode(' ')); return { sp, w: WORDS.find(x => x.seg === sg.id && x.i === i) }; });
    row.appendChild(band); box0.appendChild(row);
    const next = SEGS[k + 1];
    rows.push({ row, words, from: sg.start - 0.2, to: next ? next.start - 0.2 : sg.end + 1.2 });
  });
  let bar = null, bottom = Math.max(...rows.map(r => r.row.offsetTop + r.row.offsetHeight));
  if (C.progress !== false) {                      // a thin progress line under the captions (never under the badge)
    bar = document.createElement('div'); Object.assign(bar.style, { position: 'absolute', height: '7px', borderRadius: '4px', top: (bottom + 10) + 'px', background: color('shape'), opacity: '0.55' });
    bar.dataset.sense = 'captions'; bar.dataset.block = '0'; bar.dataset.scene = 'g'; box0.appendChild(bar); bottom += 17;
  }
  CAPS = { rows, bar, ltr, total: SEGS.at(-1).end + (L.frame.tail || 0), bottom };
}
// where the board may sit: inside the safe area and under the captions (the whole frame when neither is set)
function region() {
  const S = L.frame.safe; if (!S && !CAPS) return [0, FHt];
  return [Math.max(S ? S.top : 0, CAPS ? CAPS.bottom + 24 : 0) + 4, FHt - (S ? S.bottom : 0) - 4];   // 4 px slack for the sensor's stroke padding
}
function placeBlock(top, bot, what) {
  const [rT, rB] = region();
  if (L.frame.center_block && bot - top > rB - rT + 0.5) throw new Error(`${what} is ${(bot - top).toFixed(0)} px tall but the safe area${CAPS ? ' under the captions' : ''} is only ${(rB - rT).toFixed(0)} px (y ${rT.toFixed(0)}–${rB.toFixed(0)}): make it smaller or use a scene`);
  return L.frame.center_block ? +((rT + rB) / 2 - (top + bot) / 2).toFixed(2) : 0;
}
function animateCaptions(t) {
  for (const r of CAPS.rows) {
    const on = t >= r.from && t < r.to;
    r.row.style.visibility = on ? 'visible' : 'hidden';
    if (!on) continue;
    r.row.style.opacity = Math.min(smoother((t - r.from) / 0.15), 1 - smoother((t - r.to + 0.15) / 0.15)).toFixed(3);
    for (const { sp, w } of r.words) {
      const now = w && t >= w.start && t < w.end, said = w && t >= w.end;
      sp.style.color = now ? color('accent') : T.ink; sp.style.opacity = now || said ? '1' : '0.38';
    }
  }
  if (CAPS.bar) {                                  // grows in reading direction, inside the safe area
    const f = clamp01(t / CAPS.total), w = (FW - SAFE.left - SAFE.right - 40) * f;
    CAPS.bar.style.width = w.toFixed(1) + 'px'; CAPS.bar.style[CAPS.ltr ? 'left' : 'right'] = ((CAPS.ltr ? SAFE.left : SAFE.right) + 20) + 'px';
  }
}
function animateWave(v, t) {                      // pure function of t: bars rest as dots, and dance while a word is spoken
  v.bars.setAttribute('opacity', smoother((t - v.e.end + 0.3) / 0.3).toFixed(3));
  const w = WORDS.find(w => t >= w.start && t < w.end), lvl = w ? Math.pow(Math.sin(Math.PI * (t - w.start) / (w.end - w.start)), 0.5) : 0;
  for (const b of v.list) {
    const hh = v.base + v.amp * lvl * b.weight * (0.45 + 0.55 * Math.abs(Math.sin(2 * Math.PI * b.f * t + b.ph)));
    b.line.setAttribute('y1', f1(v.y - hh)); b.line.setAttribute('y2', f1(v.y + hh));
  }
}
function animateMascot(m, t) {                    // pure function of t: fill, face, blink, gaze, beak
  m.fill.setAttribute('opacity', smoother((t - m.e.start) / m.e.dur).toFixed(3));
  m.face.setAttribute('opacity', smoother((t - m.e.end + 0.3) / 0.3).toFixed(3));
  const shut = m.blinks.some(b => t >= b && t < b + 0.13);
  let i = -1; while (i + 1 < LOOK.length && LOOK[i + 1].start <= t) i++;
  for (const eye of m.eyes) {
    const dir = c => { if (!c) return [0, 0.35]; const dx = c[0] - eye.cx, dy = c[1] - eye.cy, n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; };
    const a = dir(i > 0 ? LOOK[i - 1].c : null), b = dir(i >= 0 ? LOOK[i].c : null), u = i >= 0 ? smoother((t - LOOK[i].start) / 0.25) : 1;
    const ox = (a[0] + (b[0] - a[0]) * u) * 10 * m.k, oy = (a[1] + (b[1] - a[1]) * u) * 10 * m.k;
    eye.pupil.setAttribute('transform', `translate(${f1(ox)} ${f1(oy)})`);
    eye.pupil.setAttribute('visibility', shut ? 'hidden' : 'visible'); eye.lid.setAttribute('visibility', shut ? 'visible' : 'hidden');
  }
  const w = WORDS.find(w => t >= w.start && t < w.end);
  const open = w ? Math.pow(Math.sin(Math.PI * (t - w.start) / (w.end - w.start)), 0.6) * (0.55 + 0.45 * Math.abs(Math.sin(2 * Math.PI * 4.5 * (t - w.start)))) : 0;
  const [mx, my] = m.mouth, k = m.k;
  m.lower.setAttribute('d', `M${f1(mx - 10 * k)} ${f1(my - 2 * k)}L${f1(mx + 10 * k)} ${f1(my - 2 * k)}L${f1(mx)} ${f1(my + (8 + 16 * open) * k)}Z`);
}

// ---------- pen tip ----------
const TIPS = [];
function buildPools() {
  for (let i = 0; i < 4; i++) {
    const g = document.createElementNS(NS, 'g'); g.setAttribute('visibility', 'hidden');
    g.innerHTML = T.pen === 'chalk'
      ? `<g transform="rotate(-52)"><rect x="0" y="-9" width="118" height="18" rx="7"/><rect x="0" y="-9" width="16" height="18" rx="7" fill="${T.paper}" fill-opacity="0.25"/></g>`
      : T.pen === 'marker'
      ? `<g transform="rotate(-52)"><path d="M1 0L21 -7L21 7Z"/><rect x="20" y="-10" width="13" height="20" rx="2" fill="${T.ink}"/>` +
        `<rect x="32" y="-14" width="150" height="28" rx="7" fill="${T.paper}" stroke="${T.ink}" stroke-width="3"/><rect x="146" y="-14" width="36" height="28" rx="7"/>` +
        `<rect x="44" y="-8" width="80" height="5" rx="2.5" fill="${T.ink}" fill-opacity="0.12"/></g>`
      : `<circle r="15" fill-opacity="0.16"/><circle r="7.5"/><circle r="2.6" cx="-2.2" cy="-2.2" fill="${T.paper}" fill-opacity="0.7"/>`;
    $('gMark').appendChild(g); TIPS.push(g);
  }
}
const progress = (e, t) => clamp01((t - e.start) / e.dur);
function tip(e, p) {
  if (e.type === 'pen') {
    const s = e.strokes.find(s => p <= s.b) || e.strokes.at(-1);
    if (p < s.a) { const prev = e.strokes[e.strokes.indexOf(s) - 1]; const a = prev.el.getPointAtLength(prev.L), b = s.el.getPointAtLength(0), u = (p - prev.b) / (s.a - prev.b);
      return e.at(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u); }
    const q = s.el.getPointAtLength(s.L * easeStroke(clamp01((p - s.a) / (s.b - s.a)))); return e.at(q.x, q.y);
  }
  const ep = easeWipe(p), span = e.b.w + 48;
  const cy = e.b.y + e.b.h * 0.52 + e.b.h * 0.16 * Math.sin(p * 31 + e.start * 7) + e.b.h * 0.06 * Math.sin(p * 83);
  return [e.dir === 'ltr' ? e.b.x - 24 + ep * span : e.b.x + e.b.w + 24 - ep * span, cy];
}

// ---------- seek(t): pure function of t ----------
function seek(t) {
  const prog = []; let tipN = 0;
  board.style.transform = `translate(0.000px, ${DY.toFixed(3)}px) scale(1.00000)`;
  for (const e of EVENTS) {
    const p = progress(e, t); prog.push(p);
    if (e.type === 'pen' && e.appear) {           // a recap: already written, it fades in instead of being drawn
      const o = (0.15 + 0.85 * smoother(p)).toFixed(3);   // visible from its first frame, so it lands on its word
      for (const s of e.strokes) { s.el.setAttribute('visibility', p > 0 ? 'visible' : 'hidden'); s.el.setAttribute('stroke-dashoffset', '0'); s.el.setAttribute('opacity', o); }
    } else if (e.type === 'pen') {
      for (const s of e.strokes) {
        const q = clamp01((p - s.a) / (s.b - s.a));
        s.el.setAttribute('visibility', p > 0 && q > 0 ? 'visible' : 'hidden');
        s.el.setAttribute('stroke-dashoffset', f1((s.L + 2) * (1 - easeStroke(q))));
      }
    } else if (e.type === 'wash') {
      for (const q of e.els) q.setAttribute('visibility', p > 0 ? 'visible' : 'hidden');
      e.circ.setAttribute('r', f1(e.R * smoother(p)));
    } else {
      const st = e.el.style; st.visibility = p > 0 ? 'visible' : 'hidden';
      if (e.appear) { st.webkitMaskImage = st.maskImage = 'none'; if (!e.fade) st.opacity = (0.15 + 0.85 * smoother(p)).toFixed(3); continue; }   // a recap fades in, no pen
      const edge = easeWipe(p) * (e.w + 48) - 24;
      const m = p >= 1 ? 'none' : `linear-gradient(${e.dir === 'ltr' ? 'to right' : 'to left'}, #000 ${edge.toFixed(2)}px, transparent ${(edge + 22).toFixed(2)}px)`;
      st.webkitMaskImage = m; st.maskImage = m;
    }
    if (p > 0 && p < 1 && tipN < TIPS.length && e.type !== 'wash' && !e.noTip) {
      const [x, y] = tip(e, p), g = TIPS[tipN++];
      g.setAttribute('visibility', 'visible'); g.setAttribute('fill', e.color); g.setAttribute('transform', `translate(${f1(x)} ${f1(y)})`);
    }
  }
  for (let i = tipN; i < TIPS.length; i++) TIPS[i].setAttribute('visibility', 'hidden');
  for (const e of EVENTS) if (e.fade) {
    const o = (1 - smoother((t - e.fade.at) / e.fade.dur)).toFixed(3);
    if (e.el) e.el.style.opacity = o; else for (const st of e.strokes) st.el.setAttribute('opacity', o);
  }
  if (CAPS) animateCaptions(t);
  for (const m of MASCOTS) animateMascot(m, t);
  for (const v of WAVES) animateWave(v, t);
  if (SCENED) SCENES.forEach((S, k) => {
    const nx = SCENES[k + 1], o = nx ? (1 - smoother((t - nx.start) / nx.fade)).toFixed(3) : '1.000';
    S.g.setAttribute('opacity', o); S.texts.style.opacity = o;
  });
  return prog;
}

// ---------- margin sensor: real on-screen boxes of every element, drawn or not ----------
function sense() {
  const st = stage.getBoundingClientRect(), acc = {};
  for (const el of document.querySelectorAll('[data-sense]')) {
    const r = el.getBoundingClientRect(), pad = el.tagName === 'path' ? parseFloat(el.getAttribute('stroke-width')) / 2 + 2.2 : 0;
    const b = { l: (r.left - st.left) / SCALE - pad, t: (r.top - st.top) / SCALE - pad, r: (r.right - st.left) / SCALE + pad, b: (r.bottom - st.top) / SCALE + pad };
    const k = el.dataset.sense, a = acc[k];
    acc[k] = a ? { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) } : b;
  }
  const out = {};
  for (const k in acc) {
    const a = acc[k], o = out[k] = { left: a.l, top: a.t, right: FW - a.r, bottom: FHt - a.b };
    o.min = L.frame.safe ? Math.min(o.left - SAFE.left, o.top - SAFE.top, o.right - SAFE.right, o.bottom - SAFE.bottom) + MARGIN : Math.min(o.left, o.top, o.right, o.bottom);
  }
  return out;
}
function seekSense(t) { const prog = seek(t); return { prog, sense: sense() }; }
function eventInfo() {
  return EVENTS.map(e => {
    let b;
    if (e.type === 'wipe') b = e.b;
    else if (e.type === 'wash') b = e.bb;
    else { const bs = e.strokes.map(s => s.el.getBBox()); const x0 = Math.min(...bs.map(q => q.x)), y0 = Math.min(...bs.map(q => q.y));
      b = { x: x0, y: y0, w: Math.max(...bs.map(q => q.x + q.width)) - x0, h: Math.max(...bs.map(q => q.y + q.height)) - y0 }; }
    const until = e.fade ? e.fade.at + e.fade.dur : e.end;   // until: the event keeps changing the screen while it fades
    if (e.type === 'wipe') return { id: e.id, label: e.label, anchor: e.anchor, off: e.off, start: e.start, end: e.end, until, bbox: { x: b.x, y: b.y + DY, w: b.w, h: b.h }, scene: e.scene };
    const [x0, y0] = e.at(b.x, b.y), [x1, y1] = e.at(b.x + b.w, b.y + b.h);
    return { id: e.id, label: e.label, anchor: e.anchor, off: e.off, start: e.start, end: e.end, until, bbox: { x: x0, y: y0 + DY, w: x1 - x0, h: y1 - y0 }, scene: e.scene };
  });
}
function arrowGaps() {                           // measured: distance from each arrow's drawn tip to its target's ink
  return Object.entries(ARROW_TIPS).map(([id, a]) => {
    const tb = inkBox(a.target), ab = STROKES[id][0], w = ab.width / 2;
    return { arrow: id, target: a.target, gapPx: +(rectDist(a.tip, tb) - w).toFixed(2), wanted: a.gap };
  });
}
function info() {
  return { DY, block: [+BLOCK.top.toFixed(1), +BLOCK.bottom.toFixed(1)], blockCentre: +((BLOCK.top + BLOCK.bottom) / 2).toFixed(2), blockTarget: +(region().reduce((a, b) => a + b) / 2).toFixed(2), safe: L.frame.safe || null,
           minFontPx: Math.min(...[...document.querySelectorAll('#texts span, .texts span')].map(e => parseFloat(getComputedStyle(e).fontSize))),
           order: ORDER, arrows: arrowGaps(), columns: COLUMNS, math: MATH, squeezed: TRIMMED, pen: PEN, idle: IDLE,
           boards: SCENED ? SCENES.map(S => ({ id: S.id, start: S.start, scale: +(S.k ?? 1).toFixed(3), block: S.block ? [+S.block.top.toFixed(1), +S.block.bottom.toFixed(1)] : null })) : null };
}

window.ready = (async () => {
  applyTheme();
  const face = new FontFace('Pen', `url(${window.ROOT}/${T.font})`, { weight: '700' });
  await face.load(); document.fonts.add(face);
  await document.fonts.ready;
  if (!document.fonts.check('700 66px Pen')) throw new Error('theme font did not load');
  build(); buildPools();
  // pen diagnostics: where every visible pen tip is at time t (used by scripts/pencheck.js)
  const tipsAt = t => EVENTS.map((e, i) => ({ e, i, p: progress(e, t) })).filter(o => o.p > 0 && o.p < 1 && o.e.type !== 'wash' && !o.e.noTip)
    .map(o => { const [x, y] = tip(o.e, o.p); return { id: o.e.id, x: +x.toFixed(1), y: +(y + DY).toFixed(1), type: o.e.type, scene: o.e.scene, dur: o.e.dur }; });
  // worksheet blanks (scripts/worksheet.js): after a seek, hide an element so the student writes it in its place
  const blank = ids => EVENTS.filter(e => ids.some(i => e.id === i || e.id.startsWith(i + '.'))).forEach(e => {
    (e.strokes || []).forEach(s => s.el.setAttribute('visibility', 'hidden')); (e.els || []).forEach(q => q.setAttribute('visibility', 'hidden')); if (e.el && e.el.style) e.el.style.visibility = 'hidden'; });
  const nodes = e => [...(e.strokes || []).map(s => s.el), ...(e.els || []), ...(e.el && e.el.getBoundingClientRect ? [e.el] : [])];
  const union = rs => { rs = rs.filter(r => r.width > 0 || r.height > 0); if (!rs.length) return null; const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
    return { x, y, w: Math.max(...rs.map(r => r.right)) - x, h: Math.max(...rs.map(r => r.bottom)) - y }; };
  const rectOf = ids => union(EVENTS.filter(e => ids.some(i => e.id === i || e.id.startsWith(i + '.'))).flatMap(nodes).map(n => n.getBoundingClientRect()));   // screen px
  const sceneRect = sc => union(EVENTS.filter(e => e.scene === sc && !e.deco && e.type !== 'wash').flatMap(nodes).filter(n => n.getAttribute('visibility') !== 'hidden' && n.style.visibility !== 'hidden' && +(n.getAttribute('opacity') ?? 1) > 0.05).map(n => n.getBoundingClientRect()));
  Object.assign(window, { seek, seekSense, eventInfo, info, tipsAt, blank, rectOf, sceneRect, scenes: () => SCENES.map(S => ({ id: S.id, start: S.start, fade: S.fade })) });
  seek(0);
  return true;
})();
