// node scripts/still.js --dir lessons/try-demo --t 3.5,7.2   ·   --boards: each finished board as board-N.png (1080x1920)
// Stills of a lesson at given seconds (540x960), side by side in one PNG — to look at a moment without rendering a video.
// Writes out/still-<dir>/stills.png. (Below: shared setup copied from cover.js.)
// ---
// The cover image for Reels / TikTok / YouTube Shorts (1080x1920 PNG), for any subject: a finished board of the lesson (no pen,
// no captions), with the subject, title and question in a card at the top of the centre 3:4 area (what the profile grid shows), over the badge.
// Text: plan.json › cover { title, question, board } — or plan.title / the first "title" beat, and the first step's title.
// Writes out/cover-<dir>/cover.png.
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir'); if (!dir) throw new Error('usage: node scripts/cover.js --dir <lesson folder> [--board N]');
const D = path.resolve(ROOT, dir); if (path.relative(ROOT, D).startsWith('..')) throw new Error(`path outside the skill folder refused: ${dir}`);
const J = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const lesson = J('lesson.json'), theme = J('theme.json'), segJ = J('segments.json'), words = align(segJ.segments, J('words.json').words);
const plan = fs.existsSync(path.join(D, 'plan.json')) ? J('plan.json') : {}, C = plan.cover || {};
const beats = (plan.steps || []).flatMap(s => s.beats || []);
const title = C.title || plan.title || (beats.find(b => b.do === 'title') || {}).text || (plan.steps && plan.steps[0] && plan.steps[0].title) || lesson.events.find(e => e.tool === 'title')?.text || '';
const question = C.question ?? (plan.steps && plan.steps.length > 1 ? plan.steps.map(s => s.title).slice(0, 3).join(' · ') : '');
const ltr = plan.lang && plan.lang !== 'ar';
const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
const OUT = path.join(ROOT, 'out', 'still-' + dir.replace(/[\\/]/g, '-')); fs.mkdirSync(OUT, { recursive: true });
const exe = () => {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(process.env.HOME || '', '.cache', 'ms-playwright'), path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const r of roots) { if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const e = path.join(r, d, sub); if (fs.existsSync(e)) return e; } }
  throw new Error('no cached Chromium headless shell found');
};
(async () => {
  const ts = String(arg('t', '1')).split(',').map(Number);
  const b = await chromium.launch({ executablePath: exe(), args: ['--disable-gpu', '--disable-partial-raster'] });
  const page = await b.newPage({ viewport: { width: 540, height: 960 } });
  let err = null; page.on('pageerror', e => { err = err || e.message; });
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready).catch(e => { err = err || e.message; });
  if (err) { console.log(`the lesson does not build: ${err}`); await b.close(); process.exit(1); }
  if (process.argv.includes('--boards')) {          // --boards: every finished board as its own PNG (1080x1920, no pen, no captions)
    await page.setViewportSize({ width: 540, height: 960 });
    const info = await page.evaluate(() => window.info()), end = segJ.duration + lesson.frame.tail - 0.05, B = info.boards || [{ start: -1e9 }];
    const big = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
    await big.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
    await big.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href); await big.evaluate(() => window.ready);
    for (let k = 0; k < B.length; k++) {
      await big.evaluate(t => { window.seek(t); document.querySelectorAll('#gMark > g').forEach(g => g.setAttribute('visibility', 'hidden')); const c = document.getElementById('caps'); if (c) c.style.display = 'none'; }, B[k + 1] ? B[k + 1].start - 0.06 : end);
      await big.screenshot({ path: path.join(OUT, `board-${k + 1}.png`) });
    }
    await b.close(); console.log(`${B.length} board(s) → ${path.relative(ROOT, OUT)}/board-N.png`); return;
  }
  const shots = [];
  for (const t of ts) { await page.evaluate(t => window.seek(t), t); shots.push((await page.screenshot({ type: 'png' })).toString('base64')); }
  const sheet = await b.newPage({ viewport: { width: 280 * ts.length, height: 520 } });
  await sheet.setContent(`<body style="margin:0;display:flex;background:#333">${shots.map((s, i) => `<div style="width:270px;margin:5px;color:#fff;font:13px sans-serif"><img src="data:image/png;base64,${s}" style="width:270px">${ts[i]} s</div>`).join('')}</body>`);
  await sheet.screenshot({ path: path.join(OUT, 'stills.png'), fullPage: true });
  await b.close(); console.log(`stills at ${ts.join(', ')} s → ${path.relative(ROOT, path.join(OUT, 'stills.png'))}`);
})();
