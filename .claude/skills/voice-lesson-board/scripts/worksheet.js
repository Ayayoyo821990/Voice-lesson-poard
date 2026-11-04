// node scripts/worksheet.js --dir lessons/img8818
// The printable worksheet (A4 PDF) made from the SAME lesson as the video, so the class gets it with the video:
//   page 1  «كمّل الخطوات»: every board as the student saw it, with the step's last line hidden behind a dotted box to fill in;
//           then «وقّف وجرّب» / «الغلطة المشهورة» if the plan has them, and «تمرّن لحالك» (plan.json → worksheet.practice)
//   page 2  «الحل كامل»: the finished boards — the answer key the teacher can cut off.
// Writes out/worksheet-<dir>/worksheet.pdf (+ worksheet.html). No drawing is redone by hand: the boards come from the engine.
const path = require('path'), fs = require('fs'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('dir'); if (!dir) throw new Error('usage: node scripts/worksheet.js --dir <lesson folder>');
const D = path.resolve(ROOT, dir); if (path.relative(ROOT, D).startsWith('..')) throw new Error(`path outside the skill folder refused: ${dir}`);
const J = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const lesson = J('lesson.json'), theme = J('theme.json'), segJ = J('segments.json'), words = align(segJ.segments, J('words.json').words);
const plan = fs.existsSync(path.join(D, 'plan.json')) ? J('plan.json') : {};
const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
const OUT = path.join(ROOT, 'out', 'worksheet-' + dir.replace(/[\\/]/g, '-')); fs.mkdirSync(OUT, { recursive: true });
const exe = () => {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(process.env.HOME || '', '.cache', 'ms-playwright'), path.join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const r of roots) { if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse())
      for (const sub of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-mac-x64/chrome-headless-shell']) {
        const e = path.join(r, d, sub); if (fs.existsSync(e)) return e; } }
  throw new Error('no cached Chromium headless shell found');
};
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const digits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
(async () => {
  const t0 = Date.now(), b = await chromium.launch({ executablePath: exe(), args: ['--disable-gpu', '--disable-partial-raster'] });
  const page = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });   // 2x: sharp on paper
  let err = null; page.on('pageerror', e => { err = err || e.message; });
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: pathToFileURL(ROOT).href });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready).catch(e => { err = err || e.message; });
  if (err) { console.log(`the lesson does not build: ${err}`); await b.close(); process.exit(1); }
  const info = await page.evaluate(() => window.info()), evs = await page.evaluate(() => window.eventInfo());
  const end = segJ.duration + lesson.frame.tail - 0.05;
  const boards = (info.boards || [{ id: 'board', start: -1e9 }]).map((B, k, all) => ({ ...B, k, until: all[k + 1] ? all[k + 1].start - 0.06 : end }));
  const byId = Object.fromEntries(lesson.events.map(e => [e.id, e])), base = id => id.split('.')[0];
  const inBoard = B => evs.filter(v => info.boards ? v.scene === B.k : true);
  const title = B => { const s = inBoard(B).map(v => byId[base(v.id)]).find(e => e && e.tool === 'text' && e.group === 'steps'); return s ? s.text : `خطوة ${digits(B.k + 1)}`; };
  // the line to fill in: the last line of work written on the board (not the recap at its top, not a decoration)
  const blankOf = B => { const c = inBoard(B).filter(v => { const e = byId[base(v.id)]; return e && ['expr', 'column', 'fraction'].includes(e.tool) && !/_hero$|^hero$/.test(e.id) && !e.wrong_on_purpose && e.group !== 'mistake'; });
    return c.length ? base(c.sort((a, z) => a.start - z.start).at(-1).id) : null; };
  const shot = async (B, hide) => {
    const r = await page.evaluate(([t, sc, hide, marks]) => { window.seek(t);
      document.querySelectorAll('#gMark > g').forEach(g => g.setAttribute('visibility', 'hidden'));   // no pen on paper
      const c = document.getElementById('caps'); if (c) c.style.display = 'none';
      document.querySelectorAll('.ws-box').forEach(n => n.remove());
      const box = window.sceneRect(sc) || { x: 30, y: 200, w: 480, h: 600 };
      let hole = null;
      if (hide) { hole = window.rectOf([hide]); window.blank([hide, ...marks]);
        if (hole) { const d = document.createElement('div'); d.className = 'ws-box';
          Object.assign(d.style, { position: 'fixed', left: (hole.x - 8) + 'px', top: (hole.y - 6) + 'px', width: (hole.w + 16) + 'px', height: (hole.h + 12) + 'px',
            border: '2.5px dashed #8A8F98', borderRadius: '10px', boxSizing: 'border-box', zIndex: 99 }); document.body.appendChild(d); } }
      return box; }, [B.until, info.boards ? B.k : undefined, hide, hide ? marksOn(hide) : []]);
    const pad = 14, x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    const clip = { x, y, width: Math.min(540 - x, r.w + 2 * pad), height: Math.min(960 - y, r.h + 2 * pad) };
    return { img: (await page.screenshot({ type: 'jpeg', quality: 88, clip })).toString('base64'), ratio: clip.width / clip.height };
  };
  const marksOn = id => lesson.events.filter(e => [].concat(e.of || []).some(o => base(String(o)) === id)).map(e => e.id);   // a highlight on the hidden line would give it away
  const cards = [];
  for (const B of boards) {
    const hide = blankOf(B);
    cards.push({ k: B.k + 1, title: title(B), hide, ask: hide ? await shot(B, hide) : null, full: await shot(B, null) });
  }
  // the classroom moments of the plan (they were acted in the video; on paper they become questions)
  const beats = (plan.steps || []).flatMap(s => s.beats || []);
  const tries = beats.filter(x => x.do === 'try_it'), mistakes = beats.filter(x => x.do === 'common_mistake');
  const practice = (plan.worksheet && plan.worksheet.practice) || [];
  const font = pathToFileURL(path.join(ROOT, theme.font)).href, C = { ink: theme.ink, shape: theme.shape, accent: theme.accent, paper: theme.paper };
  const card = (c, img) => `<div class="card"><div class="n"><b>${digits(c.k)}</b> ${esc(c.title)}</div><img src="data:image/jpeg;base64,${img.img}" style="aspect-ratio:${img.ratio.toFixed(3)}"></div>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
@font-face { font-family: Pen; src: url('${font}'); font-weight: 700; }
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; } body { margin: 0; font-family: Pen, 'Segoe UI', Tahoma, sans-serif; color: ${C.ink}; font-weight: 700; }
.page { page-break-after: always; } .page:last-child { page-break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid ${C.shape}; padding-bottom: 6px; margin-bottom: 8px; }
.subj { background: ${C.shape}; color: #fff; border-radius: 999px; padding: 3px 14px; font-size: 15px; }
h1 { font-size: 24px; margin: 0; } h2 { font-size: 17px; margin: 10px 0 6px; color: ${C.shape}; }
.who { display: flex; gap: 22px; font-size: 13px; margin: 4px 0 8px; } .who span { flex: 1; border-bottom: 1.5px dotted #999; padding-bottom: 2px; }
.hint { font-size: 12px; color: #666; margin-bottom: 6px; font-weight: 400; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; } .grid.key { grid-template-columns: repeat(5, 1fr); }
.card { border: 1.5px solid #DADDE2; border-radius: 10px; padding: 5px; break-inside: avoid; background: ${C.paper}; }
.card .n { font-size: 12px; margin-bottom: 3px; } .card .n b { color: #fff; background: ${C.accent}; border-radius: 50%; display: inline-block; width: 18px; text-align: center; }
.card img { width: 100%; display: block; object-fit: contain; max-height: 300px; }
.box { border: 1.5px solid #DADDE2; border-radius: 10px; padding: 8px 12px; margin-bottom: 8px; break-inside: avoid; font-size: 14px; }
.box .q { direction: ltr; text-align: center; font-size: 18px; margin: 4px 0; font-family: 'Segoe UI', 'Cambria Math', serif; }
.lines { height: 54px; background: repeating-linear-gradient(transparent 0 25px, #C9CDD3 25px 26.5px); }
.wrong { text-decoration: line-through; text-decoration-color: ${C.accent}; text-decoration-thickness: 3px; }
.foot { font-size: 10px; color: #999; text-align: center; margin-top: 6px; font-weight: 400; }
</style>
<div class="page">
 <div class="head"><h1>${esc(plan.title || lesson.title || 'ورقة عمل')}</h1>${plan.subject ? `<span class="subj">${esc(plan.subject)}</span>` : ''}</div>
 <div class="who"><span>الاسم:</span><span>الصف:</span><span>التاريخ:</span></div>
 <h2>كمّل الخطوات</h2><div class="hint">هي نفس ألواح الفيديو. اكتب مكان المربّع المنقّط السطر الناقص.</div>
 <div class="grid">${cards.map(c => card(c, c.ask || c.full)).join('')}</div>
 ${tries.length ? `<h2>وقّف وجرّب</h2>${tries.map(t => `<div class="box">${esc(t.prompt || 'وقّف وجرّب!')}<div class="q">${esc(t.question)}</div><div class="lines"></div></div>`).join('')}` : ''}
 ${mistakes.length ? `<h2>الغلطة المشهورة</h2>${mistakes.map(m => `<div class="box">وين الغلط؟ صحّحه:<div class="q"><span class="wrong">${esc(m.wrong)}</span></div><div class="lines"></div></div>`).join('')}` : ''}
 ${practice.length ? `<h2>تمرّن لحالك</h2>${practice.map((p, i) => `<div class="box">${digits(i + 1)}. ${esc(p.say || 'حل:')}<div class="q">${esc(p.text)}</div><div class="lines"></div></div>`).join('')}` : ''}
</div>
<div class="page">
 <div class="head"><h1>الحل كامل</h1><span class="subj">للمعلّم</span></div>
 <div class="grid key">${cards.map(c => card(c, c.full)).join('')}</div>
 ${practice.some(p => p.answer) ? `<h2>حلول «تمرّن لحالك»</h2><div class="box">${practice.map((p, i) => `${digits(i + 1)}. <bdi dir="ltr">${esc(p.answer || "—")}</bdi>`).join(' &nbsp;·&nbsp; ')}</div>` : ''}
 ${mistakes.length ? `<div class="box">الغلطة المشهورة: الصح <bdi dir="ltr">${mistakes.map(m => esc(m.right)).join(" ، ")}</bdi></div>` : ''}
 <div class="foot">من نفس درس الفيديو (${esc(dir)}) — voice-lesson-board</div>
</div></html>`;
  fs.writeFileSync(path.join(OUT, 'worksheet.html'), html);
  const sheet = await b.newPage(); await sheet.setContent(html); await sheet.evaluate(() => document.fonts.ready);
  await sheet.pdf({ path: path.join(OUT, 'worksheet.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await sheet.setViewportSize({ width: 794, height: 1123 }); await sheet.screenshot({ path: path.join(OUT, 'worksheet-preview.png'), fullPage: true });
  await b.close();
  const missing = cards.filter(c => !c.hide).map(c => c.k);
  console.log(`worksheet: ${cards.length} boards (${cards.length - missing.length} with a line to fill in${missing.length ? '; nothing to blank on ' + missing.join(', ') : ''}), ${tries.length} try-it, ${mistakes.length} mistake, ${practice.length} practice → ${path.relative(ROOT, path.join(OUT, 'worksheet.pdf'))} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
})();
