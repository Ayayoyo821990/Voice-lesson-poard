// node scripts/pencheck.js --dir lessons/img8818
// Pen quality, measured on every frame (no video): where each visible pen tip is, and what would look like a glitch:
//   jump     — the same pen moves more than `jump` px between two frames (a teleport, not drawing)
//   crowd    — more than one pen on screen at once
//   blink    — a drawing shorter than 0.25 s (the pen appears and vanishes)
//   turn     — a pen visible while its board is fading out at a page turn
//   outside  — a pen tip outside the frame's safe area
// Prints a summary and the worst moments; exits 1 if anything is found.
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir'), JUMP = +arg('jump', 90);
const D = path.resolve(ROOT, dir), J = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const lesson = J('lesson.json'), theme = J('theme.json'), segJ = J('segments.json'), words = align(segJ.segments, J('words.json').words);
const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
const exe = () => {                               // the cached Chromium headless shell: Windows, macOS or Linux
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(process.env.HOME || '', '.cache', 'ms-playwright'), path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const r of roots) { if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const f = path.join(r, d, sub); if (fs.existsSync(f)) return f; } }
  throw new Error('no cached Chromium headless shell found (set PLAYWRIGHT_BROWSERS_PATH)'); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PW_EXE || exe(), args: ['--disable-gpu'] });
  const page = await b.newPage({ viewport: { width: lesson.frame.w / 2, height: lesson.frame.h / 2 } });
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready);
  const fps = lesson.frame.fps, N = Math.round((segJ.duration + lesson.frame.tail) * fps), S = lesson.frame.safe || { top: 60, bottom: 60, left: 60, right: 60 };
  const frames = await page.evaluate(([N, fps]) => Array.from({ length: N }, (_, f) => window.tipsAt(f / fps)), [N, fps]);
  const scenes = await page.evaluate(() => window.scenes());
  const ev = await page.evaluate(() => window.eventInfo());
  await b.close();
  const found = { jump: [], crowd: [], blink: [], turn: [], outside: [] };
  frames.forEach((tips, f) => {
    if (tips.length > 1) found.crowd.push({ f, ids: tips.map(t => t.id) });
    const prev = f ? frames[f - 1] : [];
    for (const t of tips) {
      const q = prev.find(p => p.id === t.id);
      if (q) { const d = Math.hypot(t.x - q.x, t.y - q.y); if (d > JUMP) found.jump.push({ f, id: t.id, d: +d.toFixed(0) }); }
      const sc = scenes[t.scene + 1]; if (typeof t.scene === 'number' && sc && f / fps > sc.start) found.turn.push({ f, id: t.id });
      if (t.x < 0 || t.x > lesson.frame.w || t.y < S.top - 40 || t.y > lesson.frame.h - S.bottom + 40) found.outside.push({ f, id: t.id, x: t.x, y: t.y });
    }
  });
  for (const e of ev) if (e.end - e.start < 0.25 && !['badge', 'voice'].includes(e.id)) found.blink.push({ id: e.id, dur: +(e.end - e.start).toFixed(2) });
  const uniq = (a, k = 'id') => [...new Map(a.map(x => [x[k], x])).values()];
  const crowdSec = (found.crowd.length / fps).toFixed(1);
  console.log(`${dir}: ${N} frames, pen visible on ${frames.filter(t => t.length).length} of them`);
  console.log(`  jump    ${found.jump.length} frame(s) in ${uniq(found.jump).length} drawing(s)${found.jump.length ? ': ' + uniq(found.jump).slice(0, 8).map(j => `${j.id} ${j.d}px @${(j.f / fps).toFixed(2)}s`).join(', ') : ''}`);
  console.log(`  crowd   ${crowdSec} s with 2+ pens${found.crowd.length ? ': ' + uniq(found.crowd.map(c => ({ id: c.ids.join('+'), f: c.f }))).slice(0, 6).map(c => `${c.id} @${(c.f / fps).toFixed(1)}s`).join(', ') : ''}`);
  console.log(`  blink   ${found.blink.length} drawing(s) under 0.25 s${found.blink.length ? ': ' + found.blink.slice(0, 10).map(b => `${b.id} ${b.dur}s`).join(', ') : ''}`);
  console.log(`  turn    ${uniq(found.turn).length} drawing(s) with a pen during a page turn`);
  console.log(`  outside ${uniq(found.outside).length} drawing(s) with the pen outside the safe area`);
  fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'out', 'pencheck-' + dir.replace(/[\\/]/g, '-') + '.json'), JSON.stringify(found, null, 1));
  process.exit(Object.values(found).some(a => a.length) ? 1 : 0);
})();
