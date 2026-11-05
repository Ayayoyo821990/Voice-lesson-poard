// node scripts/check.js --dir example5   — a fast look at a lesson before rendering (seconds, no video).
// Builds the board once and reports: build errors (wrong anchors, wrong maths, a drawing crossing a page turn),
// the maths of every expr / column, anchors that fall back because their word was unclear, and margin problems
// (sampled every 0.25 s). It does not replace selftest.js (determinism, frame-exact sync).
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir', 'example'), D = path.resolve(ROOT, dir);
if (path.relative(ROOT, D).startsWith('..')) throw new Error(`path outside the skill folder refused: ${dir}`);
const J = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const lesson = J('lesson.json'), theme = J('theme.json'), segJ = J('segments.json');
const words = align(segJ.segments, J('words.json').words);
const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
function findChrome() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(process.env.HOME || '', '.cache', 'ms-playwright'), path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const exe = path.join(r, d, sub); if (fs.existsSync(exe)) return exe;
      }
  }
  throw new Error('no cached Chromium headless shell found (set PLAYWRIGHT_BROWSERS_PATH)');
}
(async () => {
  const b = await chromium.launch({ executablePath: findChrome(), args: ['--disable-gpu'] });
  const page = await b.newPage({ viewport: { width: lesson.frame.w / 2, height: lesson.frame.h / 2 } });
  let err = null; page.on('pageerror', e => { err = err || e.message; });
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready).catch(e => { err = err || e.message; });
  if (err || !(await page.evaluate(() => typeof window.info === 'function'))) { console.log(`FAIL  the lesson does not build:\n  ${err}`); await b.close(); process.exit(1); }
  const info = await page.evaluate(() => window.info()), evs = await page.evaluate(() => window.eventInfo());
  const dur = segJ.duration + lesson.frame.tail, M = lesson.frame.margin, worst = {};
  for (let t = 0; t <= dur; t += 0.25) {
    const { sense } = await page.evaluate(t => window.seekSense(t), t);
    for (const k in sense) if (!worst[k] || sense[k].min < worst[k].min) worst[k] = { min: sense[k].min, t, sides: sense[k] };
  }
  await b.close();
  const out = [], problems = [];
  // coverage: every sentence must start at least one drawing while it is being said (the badge and the voice ring do not count)
  const skip = new Set(['badge', 'voice_wave']), segs = segJ.segments, exempt = (lesson.coverage && lesson.coverage.exempt) || {};
  const evTool = Object.fromEntries(lesson.events.map(e => [e.id, e.tool]));
  const counted = evs.filter(e => !skip.has(evTool[e.id]) && e.id !== 'greet');   // a step title is a drawing too
  const bare = segs.map((s, k) => { const end = segs[k + 1] ? segs[k + 1].start : s.end + 1; return counted.some(e => e.start >= s.start - 0.15 && e.start < end) ? null : s.id; }).filter(x => x !== null && !exempt[x]);
  const cov = `${segs.length - bare.length}/${segs.length}`;
  out.push(`  coverage: ${cov} sentences start a drawing while they are said${bare.length ? ' — without one: ' + bare.join(', ') : ''}`);
  // pedagogical checks: no empty stretch on screen, one accent kept for emphasis, no overcrowded board
  if (lesson.frame.idle) {
    const max = lesson.frame.idle.max ?? 1.5, acts = [...counted.map(e => [e.start, e.until ?? e.end]), ...(info.boards || []).slice(1).map(B => [B.start, B.start + 0.6])].sort((a, b) => a[0] - b[0]), gaps = []; let until = segs[0].start;   // a page turn is a change on screen too
    for (const [s0, e0] of acts) { if (s0 - until > max + 0.05 && s0 < segs.at(-1).end) gaps.push([until, s0]); until = Math.max(until, e0); }
    out.push(`  idle: ${gaps.length ? gaps.length + ' stretch(es) with nothing new for more than ' + max + ' s: ' + gaps.slice(0, 6).map(g => g[0].toFixed(1) + '–' + g[1].toFixed(1) + ' s').join(', ') : 'never more than ' + max + ' s without something new'}${info.idle ? ` (${info.idle.pulses} pulse(s) added)` : ''}`);
    if (gaps.length) problems.push(`  idle FAIL: ${gaps.length} empty stretch(es)`);
  }
  const accentRuns = lesson.events.filter(e => e.color === 'accent').length;
  out.push(`  accent: one colour (${theme.accent}) for emphasis, used by ${accentRuns} of ${lesson.events.length} events${accentRuns / lesson.events.length > 0.35 ? ' — too often, it stops meaning "look here"' : ''}`);
  if (info.boards) {
    const busy = info.boards.map((B, k) => [k + 1, evs.filter(e => e.scene === k && !/^idle\d/.test(e.id)).length]).filter(([, n]) => n > 34);
    out.push(`  density: ${busy.length ? 'busy board(s) ' + busy.map(([k, n]) => `${k} (${n} drawings)`).join(', ') + ' — split the step' : 'no board over 34 drawings'}`);
  }
  if (bare.length && lesson.coverage && lesson.coverage.strict) problems.push(`  coverage FAIL: sentence(s) ${bare.join(', ')} have no drawing`);
  out.push(`${dir}: ${evs.length} drawing events, ${dur.toFixed(1)} s${segJ.synthetic ? '  (SYNTHETIC timing)' : ''}`);
  if (info.pen) out.push(`  calm pen: ${info.pen.moved} drawing(s) waited for the pen (max ${info.pen.maxShift} s), ${info.pen.recaps} recap(s) fade in, ${info.pen.lost} new drawing(s) without a pen${info.pen.lost ? ': ' + info.pen.lostIds.join(', ') : ''}`);
  if ((info.squeezed || []).length) out.push(`  squeezed before a page turn: ${info.squeezed.join(', ')}`);
  for (const m of info.math || []) out.push(`  maths ${m.ok ? 'ok  ' : 'FAIL'} ${m.id}: ${m.text}${m.onPurpose ? '  (wrong on purpose)' : ''}${m.detail && !m.onPurpose ? ' — ' + m.detail : ''}`);
  for (const [id, c] of Object.entries(info.columns || {})) out.push(`  column ${id}: answer ${c.result}, steps ${c.steps.join(' ')}`);
  const fb = evs.filter(e => e.anchor.note === 'fallback');
  if (fb.length) out.push(`  ${fb.length} drawing(s) use fallback_offset because the word was unclear: ${fb.map(e => e.id).join(', ')}`);
  for (const [k, w] of Object.entries(worst)) if (w.min < M) problems.push(`  margin FAIL: "${k}" comes ${w.min.toFixed(0)} px from the edge at ${w.t.toFixed(2)} s (needs ${M}) — distances: left ${w.sides.left.toFixed(0)}, top ${w.sides.top.toFixed(0)}, right ${w.sides.right.toFixed(0)}, bottom ${w.sides.bottom.toFixed(0)}${lesson.frame.safe ? ' vs safe ' + JSON.stringify(lesson.frame.safe) : ''}`);
  if ((info.math || []).some(m => !m.ok)) problems.push('  maths FAIL');
  out.push(...problems, problems.length ? 'FAIL' : `PASS  (closest to an edge: ${Object.entries(worst).sort((a, b) => a[1].min - b[1].min)[0]?.map((x, i) => i ? x.min.toFixed(0) + ' px' : x).join(' ')})`);
  console.log(out.join('\n'));
  process.exit(problems.length ? 1 : 0);
})();
