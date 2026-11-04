// node scripts/cover.js --dir lessons/science [--board 1]
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
const OUT = path.join(ROOT, 'out', 'cover-' + dir.replace(/[\\/]/g, '-')); fs.mkdirSync(OUT, { recursive: true });
const exe = () => {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(process.env.HOME || '', '.cache', 'ms-playwright'), path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const r of roots) { if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const e = path.join(r, d, sub); if (fs.existsSync(e)) return e; } }
  throw new Error('no cached Chromium headless shell found');
};
(async () => {
  const b = await chromium.launch({ executablePath: exe(), args: ['--disable-gpu', '--disable-partial-raster'] });
  const page = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  let err = null; page.on('pageerror', e => { err = err || e.message; });
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready).catch(e => { err = err || e.message; });
  if (err) { console.log(`the lesson does not build: ${err}`); await b.close(); process.exit(1); }
  const info = await page.evaluate(() => window.info()), end = segJ.duration + lesson.frame.tail - 0.05;
  const boards = info.boards || [{ start: -1e9 }], k = Math.min(boards.length, +(arg('board', C.board || 1))) - 1;
  const t = boards[k + 1] ? boards[k + 1].start - 0.06 : end;
  await page.evaluate(([t, title, question, ltr, T, subject]) => {
    window.seek(t);
    document.querySelectorAll('#gMark > g').forEach(g => g.setAttribute('visibility', 'hidden'));
    const c = document.getElementById('caps'); if (c) c.style.display = 'none';
    const veil = document.createElement('div');          // the board stays readable behind, but the title is what the eye meets
    Object.assign(veil.style, { position: 'fixed', inset: '0', background: T.paper, opacity: '0.12', zIndex: 98 });
    const card = document.createElement('div'); card.dir = ltr ? 'ltr' : 'rtl';
    Object.assign(card.style, { position: 'fixed', left: '40px', right: '58px', top: '124px', zIndex: 99, background: T.paper, border: `5px solid ${T.shape}`, borderRadius: '26px',
      padding: '22px 18px 26px', textAlign: 'center', fontFamily: 'Pen, sans-serif', fontWeight: 700, color: T.ink, boxShadow: '0 6px 0 ' + T.shape + '33' });
    card.innerHTML = (subject ? `<div style="display:inline-block;font-size:18px;color:#fff;background:${T.shape};border-radius:999px;padding:2px 14px;margin-bottom:6px">${subject}</div>` : '') + `<div style="font-size:46px;line-height:1.35">${title}</div>` + (question ? `<div style="font-size:24px;line-height:1.5;margin-top:10px;color:${T.accent}">${question}</div>` : '');
    document.body.append(veil, card);
  }, [t, title, question, ltr, { paper: theme.paper, ink: theme.ink, shape: theme.shape, accent: theme.accent }, plan.subject || '']);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, 'cover.png'), type: 'png' });
  await b.close();
  console.log(`cover: board ${k + 1}, «${title}»${question ? ' · ' + question : ''} → ${path.relative(ROOT, path.join(OUT, 'cover.png'))}`);
})();
