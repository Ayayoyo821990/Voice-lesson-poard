// node scripts/render.js [--mode preview|final] [--tag a] [--report] [--dir example] [--lesson example/lesson.json] [--theme example/theme.json]
//                        [--segments example/segments.json] [--words example/words.json] [--audio example/voice.mp3]
// --dir sets the folder the five inputs default to (audio: voice.mp3, else voice.wav).
// Every path is resolved inside this skill folder; anything outside is refused.
// Writes out/<mode>-<tag>/: video.mp4 (audio muxed), result.json, and with --report: sync.md, sync.json, sensor.md, contact/ + contact-sheet.png
const path = require('path'), fs = require('fs'), crypto = require('crypto'), { spawn, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { align } = require('./align');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const inside = p => { const a = path.resolve(ROOT, p); if (path.relative(ROOT, a).startsWith('..') || path.isAbsolute(path.relative(ROOT, a))) throw new Error(`path outside the skill folder refused: ${p}`); return a; };
const mode = arg('mode', 'preview'), tag = arg('tag', 'a'), report = process.argv.includes('--report');
const dir = arg('dir', 'example'), voice = ['voice.mp3', 'voice.wav'].find(f => fs.existsSync(path.join(inside(dir), f))) || 'voice.mp3';
const F = { lesson: inside(arg('lesson', `${dir}/lesson.json`)), theme: inside(arg('theme', `${dir}/theme.json`)),
            segments: inside(arg('segments', `${dir}/segments.json`)), words: inside(arg('words', `${dir}/words.json`)), audio: inside(arg('audio', `${dir}/${voice}`)) };
const OUT = inside(`out/${mode}-${tag}`);

// Playwright must come from this folder's node_modules (npm install here), never from a parent folder
const pwPath = require.resolve('playwright', { paths: [ROOT] });
if (path.relative(ROOT, pwPath).startsWith('..')) throw new Error(`playwright resolved outside the skill folder: ${pwPath} — run "npm install" in ${ROOT}`);
const { chromium } = require(pwPath);

const lesson = JSON.parse(fs.readFileSync(F.lesson, 'utf8')), theme = JSON.parse(fs.readFileSync(F.theme, 'utf8'));
const segJ = JSON.parse(fs.readFileSync(F.segments, 'utf8')), words = align(segJ.segments, JSON.parse(fs.readFileSync(F.words, 'utf8')).words);
inside(theme.font); if (!fs.existsSync(path.resolve(ROOT, theme.font))) throw new Error(`theme font missing: ${theme.font}`);
const CFG = { preview: { w: 540, h: 960 }, final: { w: lesson.frame.w, h: lesson.frame.h } }[mode];
const FPS = lesson.frame.fps, MARGIN = lesson.frame.margin;
const DUR = +(segJ.duration + lesson.frame.tail).toFixed(3), N = Math.round(DUR * FPS);

function findChrome() {   // external requirement: Playwright's cached Chromium headless shell (never downloaded here)
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
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', '--disable-gpu',
    '--disable-partial-raster'] });   // repaint whole tiles: partial repaints of changing parts (owl face, marker) differed run to run
  const page = await browser.newPage({ viewport: { width: CFG.w, height: CFG.h }, deviceScaleFactor: 1 });
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => { console.error('[page error]', e.message); process.exit(1); });
  const rootURL = pathToFileURL(ROOT).href;
  await page.addInitScript(d => Object.assign(window, d), { LESSON: lesson, THEME: theme, SEGMENTS: segJ.segments, WORDS: words, ROOT: rootURL });
  await page.goto(pathToFileURL(path.join(ROOT, 'engine', 'board.html')).href);
  await page.evaluate(() => window.ready);
  const nEv = (await page.evaluate(() => window.eventInfo())).length;
  const shot = async (t, clip) => { await page.evaluate(t => { window.seek(t); }, t); return page.screenshot({ type: 'png', clip }); };

  const video = path.join(OUT, 'video.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', F.audio,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '4',
    '-c:a', 'aac', '-b:a', '160k', '-t', String(DUR), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags', '+bitexact',
    '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });

  const hash = crypto.createHash('sha256'), firstFrame = new Array(nEv).fill(null), worst = {}, drift = {};
  let violations = 0;
  const t0 = Date.now();
  for (let f = 0; f < N; f++) {
    const { prog, sense } = await page.evaluate(t => window.seekSense(t), f / FPS);
    prog.forEach((p, i) => { if (p > 0 && firstFrame[i] === null) firstFrame[i] = f; });
    for (const k in sense) {
      const m = sense[k];
      if (!worst[k] || m.min < worst[k].min) worst[k] = { ...m, frame: f };
      if (m.min < MARGIN) violations++;
      const d = drift[k] || (drift[k] = { lo: 1e9, hi: -1e9 }); d.lo = Math.min(d.lo, m.top); d.hi = Math.max(d.hi, m.top);
    }
    const buf = await page.screenshot({ type: 'png' });
    hash.update(buf);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`  frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  const info = await page.evaluate(() => window.info());
  const result = {
    frames: N, fps: FPS, size: CFG, frameHash: hash.digest('hex'), fileHash: crypto.createHash('sha256').update(fs.readFileSync(video)).digest('hex'),
    sensor: { margin: MARGIN, violations, pass: violations === 0, worst },
    drift: Object.fromEntries(Object.entries(drift).map(([k, d]) => [k, +(d.hi - d.lo).toFixed(3)])),
    layout: { DY: info.DY, block: info.block, blockCentre: info.blockCentre, blockTarget: info.blockTarget, safe: info.safe, minFontPx: info.minFontPx, themeMinFontPx: theme.minFontPx },
    arrows: info.arrows, math: info.math, playwright: path.relative(ROOT, pwPath), syntheticTiming: !!segJ.synthetic,
  };
  if (segJ.synthetic) console.log(' NOTE: segments.json is SYNTHETIC timing (engine test only, not a real voice)');
  console.log(`video ${path.relative(ROOT, video)}  ${N} frames  ${((Date.now() - t0) / 1000).toFixed(0)}s\n frames sha256 ${result.frameHash}\n mp4    sha256 ${result.fileHash}`);

  if (report) {
    const s = CFG.w / lesson.frame.w, pad = 24;
    const toClip = b => {
      const x = Math.max(0, (b.x - pad) * s), y = Math.max(0, (b.y - pad) * s);
      return { x, y, width: Math.max(2, Math.min(CFG.w - x, (b.w + 2 * pad) * s)), height: Math.max(2, Math.min(CFG.h - y, (b.h + 2 * pad) * s)) };
    };
    const evs = await page.evaluate(() => window.eventInfo()), rows = [];
    for (let i = 0; i < nEv; i++) {        // first frame whose pixels change inside the event's box
      const e = evs[i], clip = toClip(e.bbox); let seen = null;
      for (let f = firstFrame[i], k = 0; k < 8 && seen === null; k++, f++)
        if (Buffer.compare(await shot((f - 1) / FPS, clip), await shot(f / FPS, clip)) !== 0) seen = f;
      rows.push({ id: e.id, label: e.label, anchorType: e.anchor.type, anchor: e.anchor.text, anchorTime: +e.anchor.time.toFixed(3), offset: e.off,
        eventTime: +e.start.toFixed(3), pixelFrame: seen, deltaFrames: seen === null ? null : +(seen - e.start * FPS).toFixed(2), note: e.anchor.note, bbox: e.bbox });
    }
    const fr = id => rows.find(r => r.id === id).pixelFrame;
    result.order = info.order.map(o => ({ line: o.line, labelFrame: fr(o.label), firstItemFrame: Math.min(...o.items.map(fr)), pass: fr(o.label) < Math.min(...o.items.map(fr)) }));
    const d = rows.map(r => r.deltaFrames);
    result.sync = { rows: rows.length, maxDelta: Math.max(...d.filter(x => x !== null)), missing: d.filter(x => x === null).length };
    fs.writeFileSync(path.join(OUT, 'sync.json'), JSON.stringify(rows, null, 1));

    let md = `## segments\n| seg | start (s) | end (s) | frame |\n|---|---|---|---|\n`;
    for (const g of segJ.segments) md += `| ${g.id} | ${g.start.toFixed(3)} | ${g.end.toFixed(3)} | ${(g.start * FPS).toFixed(2)} |\n`;
    md += `\n## drawing events\n| id | event | anchor | anchor time (s) | offset | event time (s) | ideal frame | first changed frame | delta (frames) | note |\n|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const r of rows) md += `| ${r.id} | ${r.label} | ${r.anchorType}: ${r.anchor} | ${r.anchorTime.toFixed(3)} | +${r.offset.toFixed(2)} | ${r.eventTime.toFixed(3)} | ${(r.eventTime * FPS).toFixed(2)} | ${r.pixelFrame} | ${r.deltaFrames} | ${r.note} |\n`;
    md += `\nmax delta = ${result.sync.maxDelta} frames over ${rows.length} rows; missing = ${result.sync.missing}\n`;
    for (const o of result.order) md += `order check (${o.line}): label at frame ${o.labelFrame}, first item at frame ${o.firstItemFrame} → ${o.pass ? 'PASS' : 'FAIL'}\n`;
    md += `\narrow gaps (tip ink → target ink): ${info.arrows.map(a => `${a.arrow}→${a.target} ${a.gapPx} px`).join(', ')}\n`;
    md += `\nlayout: ${JSON.stringify(result.layout)}\n`;
    fs.writeFileSync(path.join(OUT, 'sync.md'), md);

    let sm = `## margin sensor (every frame, ${MARGIN} px)\n| element | min margin (px) | at frame |\n|---|---|---|\n`;
    for (const k of Object.keys(worst).sort()) sm += `| ${k} | ${worst[k].min.toFixed(1)} | ${worst[k].frame} |\n`;
    sm += `\nvertical drift (px): ${Object.entries(result.drift).map(([k, v]) => `${k} ${v}`).join(', ')}\nresult: ${result.sensor.pass ? 'PASS' : 'FAIL'} — ${violations} element-frames inside the margin\n`;
    fs.writeFileSync(path.join(OUT, 'sensor.md'), sm);

    const dir = path.join(OUT, 'contact'); fs.mkdirSync(dir, { recursive: true });
    const K = Math.floor(DUR / 0.25 + 1e-9) + 1;
    for (let k = 0; k < K; k++) fs.writeFileSync(path.join(dir, `${String(k).padStart(3, '0')}.png`), await shot(k * 0.25));
    const fontRel = path.relative(process.cwd(), path.resolve(ROOT, theme.font)).replace(/\\/g, '/');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '4', '-i', path.join(dir, '%03d.png'), '-vf',
      `scale=216:384,pad=216:412:0:28:color=0x333333,drawtext=fontfile='${fontRel}':text='%{pts\\:flt}':fontcolor=white:fontsize=18:x=6:y=3,tile=10x${Math.ceil(K / 10)}:padding=4:color=0x333333`,
      '-frames:v', '1', path.join(OUT, 'contact-sheet.png')], { stdio: 'inherit' });
    result.contact = { stills: K, every: 0.25 };
  }
  const outside = requests.filter(u => !u.startsWith(rootURL + '/'));
  result.requests = { total: requests.length, outsideSkill: outside };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
  console.log(`sensor ${result.sensor.pass ? 'PASS' : 'FAIL'}, drift ${JSON.stringify(result.drift)}, page loads outside skill: ${outside.length}`);
  await browser.close();
  if (!result.sensor.pass || outside.length) process.exit(2);
})();
