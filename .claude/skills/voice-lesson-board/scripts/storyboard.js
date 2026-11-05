// node scripts/storyboard.js --dir lessons/img8818
// The storyboard the teacher approves BEFORE any video is rendered (seconds, not minutes):
// one picture per board, taken as the board looks when it is complete, numbered, with the sentences said over it
// (✓ = a drawing starts while it is said). Writes out/storyboard-<dir>/storyboard.png and storyboard.html.
// The teacher answers in plain words ("لوح ٣: كبّر الخط", "زيد سهم هون") and the plan is edited, not the video.
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir'); if (!dir) throw new Error('usage: node scripts/storyboard.js --dir <lesson folder>');
const D = path.resolve(ROOT, dir); if (path.relative(ROOT, D).startsWith('..')) throw new Error(`path outside the skill folder refused: ${dir}`);
const J = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const lesson = J('lesson.json'), theme = J('theme.json'), segJ = J('segments.json'), words = align(segJ.segments, J('words.json').words);
const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
const OUT = path.join(ROOT, 'out', 'storyboard-' + dir.replace(/[\\/]/g, '-')); fs.mkdirSync(OUT, { recursive: true });
const exe = () => {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(process.env.HOME || '', '.cache', 'ms-playwright'), path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const r of roots) { if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const e = path.join(r, d, sub); if (fs.existsSync(e)) return e; } }
  throw new Error('no cached Chromium headless shell found');
};
(async () => {
  const t0 = Date.now(), b = await chromium.launch({ executablePath: exe(), args: ['--disable-gpu', '--disable-partial-raster'] });
  const page = await b.newPage({ viewport: { width: lesson.frame.w / 2, height: lesson.frame.h / 2 } });
  let err = null; page.on('pageerror', e => { err = err || e.message; });
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready).catch(e => { err = err || e.message; });
  if (err) { console.log(`the lesson does not build: ${err}`); await b.close(); process.exit(1); }
  const info = await page.evaluate(() => window.info()), evs = await page.evaluate(() => window.eventInfo());
  const segs = segJ.segments, end = segJ.duration + lesson.frame.tail - 0.05;
  const boards = (info.boards || [{ id: 'board', start: -1e9 }]).map((B, k, all) => ({ ...B, k, until: all[k + 1] ? all[k + 1].start - 0.06 : end }));
  const title = B => { const step = lesson.events.find(e => e.tool === 'text' && e.group === 'steps' && evs.some(v => v.id === e.id && v.start >= B.start - 0.01 && v.start < B.until)); return step ? step.text : `لوح ${B.k + 1}`; };
  const counted = evs.filter(e => !['badge', 'voice'].includes(e.id) && e.id !== 'greet');
  const cards = [];
  for (const B of boards) {
    await page.evaluate(t => { window.seek(t);       // the finished board only: no pen, no caption (the sentences are listed under it)
      document.querySelectorAll('#gMark > g').forEach(g => g.setAttribute('visibility', 'hidden'));
      const c = document.getElementById('caps'); if (c) c.style.display = 'none'; }, B.until);   // display, not visibility: a visible child would show through
    const png = await page.screenshot({ type: 'png' });
    const said = segs.filter((s, i) => s.start >= B.start - 0.01 && s.start < B.until + 0.06).map(s => {
      const k = segs.indexOf(s), stop = segs[k + 1] ? segs[k + 1].start : s.end + 1;
      return { id: s.id, text: s.text, ok: counted.some(e => e.start >= s.start - 0.15 && e.start < stop) };
    });
    cards.push({ k: B.k + 1, title: title(B), scale: B.scale, img: png.toString('base64'), said });
  }
  const font = pathToFileURL(path.join(ROOT, theme.font)).href, digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
@font-face { font-family: Pen; src: url('${font}'); font-weight: 700; }
body { margin: 0; padding: 28px; background: #EDE8DC; font-family: Pen, sans-serif; color: #1B2A3A; width: ${4 * 300 + 3 * 18}px; }
h1 { font-size: 30px; margin: 0 0 6px; } .sub { font-size: 16px; margin-bottom: 18px; color: #555; }
.grid { display: grid; grid-template-columns: repeat(4, 300px); gap: 18px; }
.card { background: #fff; border-radius: 16px; padding: 10px; box-shadow: 0 1px 3px #0002; }
.n { font-size: 20px; } .t { font-size: 15px; color: #1F6FB2; margin: 2px 0 6px; } .sc { font-size: 12px; color: #a33; }
img { width: 280px; border-radius: 10px; display: block; margin: 0 auto 8px; }
ol { margin: 0; padding: 0 18px 0 0; font-size: 13px; line-height: 1.5; } li.no { color: #c0392b; } li.no::after { content: ' ✗ بدون رسمة'; }
</style><h1>لوحة القصة — ${dir}</h1>
<div class="sub">${digits(cards.length)} ألواح · ${digits(segs.length)} جملة · ✓ كل جملة إلها رسمة وقت ما تنقال إلا المعلَّم بالأحمر · قل التعديل بكلامك: «لوح ٣: كبّر الخط»</div>
<div class="grid">${cards.map(c => `<div class="card"><div class="n">لوح ${digits(c.k)}</div><div class="t">${c.title}</div>${c.scale < 1 ? `<div class="sc">مصغّر ${Math.round(c.scale * 100)}٪ ليتسع</div>` : ''}
<img src="data:image/png;base64,${c.img}"><ol>${c.said.map(s => `<li value="${s.id}" class="${s.ok ? '' : 'no'}">${s.text}</li>`).join('')}</ol></div>`).join('')}</div></html>`;
  fs.writeFileSync(path.join(OUT, 'storyboard.html'), html);
  const sheet = await b.newPage({ viewport: { width: 4 * 300 + 3 * 18 + 56, height: 800 }, deviceScaleFactor: 1 });
  await sheet.setContent(html); await sheet.evaluate(() => document.fonts.ready);
  await sheet.screenshot({ path: path.join(OUT, 'storyboard.png'), fullPage: true });
  await b.close();
  const bare = cards.flatMap(c => c.said.filter(s => !s.ok).map(s => s.id));
  console.log(`storyboard: ${cards.length} boards, ${segs.length} sentences${bare.length ? ', without a drawing: ' + bare.join(', ') : ', all with a drawing'} → ${path.relative(ROOT, path.join(OUT, 'storyboard.png'))} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
