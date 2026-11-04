// node scripts/selftest.js [--dir example2] — renders a lesson folder twice (preview) and checks everything.
// Default folder: example (tags a/b, writes out/selftest.md). Other folders: tags <dir>-a/<dir>-b, out/selftest-<dir>.md.
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const i = process.argv.indexOf('--dir'), dir = i > 0 ? process.argv[i + 1] : 'example', pre = dir === 'example' ? '' : `${dir.replace(/[\\/]/g, '-')}-`;   // lessons/test1 → lessons-test1-
const run = tag => execFileSync(process.execPath, [path.join(__dirname, 'render.js'), '--mode', 'preview', '--dir', dir, '--tag', pre + tag, ...(tag === 'a' ? ['--report'] : [])], { cwd: ROOT, stdio: 'inherit' });
let crashed = null;
try { run('a'); run('b'); } catch (e) { crashed = e.message; }
const read = t => { const p = path.join(ROOT, 'out', `preview-${pre}${t}`, 'result.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const A = read('a'), B = read('b');
const checks = [];
const ck = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
ck('both renders finished', !crashed && A && B, crashed || '');
if (A && B) {
  ck('determinism: frame hashes equal', A.frameHash === B.frameHash, A.frameHash);
  ck('determinism: mp4 hashes equal', A.fileHash === B.fileHash, A.fileHash);
  ck(A.layout.safe ? `safe area ${JSON.stringify(A.layout.safe)} (every frame; detail = ${A.sensor.margin} + slack)` : `margin sensor (${A.sensor.margin} px, every frame)`, A.sensor.pass && B.sensor.pass, Object.entries(A.sensor.worst).map(([k, w]) => `${k} ${w.min.toFixed(1)}`).join(', '));
  ck('fixed layout: vertical drift = 0', Object.values(A.drift).every(v => v === 0), JSON.stringify(A.drift));
  ck('sync: max delta <= 2 frames, none missing', A.sync.maxDelta <= 2 && A.sync.missing === 0, `max ${A.sync.maxDelta} over ${A.sync.rows} events`);
  ck('order: every line label before its line', A.order.every(o => o.pass), A.order.map(o => `${o.line}: ${o.labelFrame} < ${o.firstItemFrame}`).join(', '));
  ck('arrow gaps = wanted (±0.5 px)', A.arrows.every(a => Math.abs(a.gapPx - a.wanted) <= 0.5), A.arrows.map(a => `${a.arrow} ${a.gapPx}`).join(', '));
  ck('maths in every expr is true', (A.math || []).every(m => m.ok), (A.math || []).length ? A.math.map(m => `${m.id} ${m.ok ? (m.onPurpose ? 'wrong on purpose' : 'ok') : m.detail}`).join(', ') : 'no expr')
  ck(`fonts >= theme minimum (${A.layout.themeMinFontPx} px)`, A.layout.minFontPx >= A.layout.themeMinFontPx, `${A.layout.minFontPx} px`);
  const target = A.layout.blockTarget ?? 960;     // 960 = half the frame; with captions/safe area: the middle of the space left for the board
  ck(`block centred in its area (${target})`, Math.abs(A.layout.blockCentre - target) < 0.01, `centre ${A.layout.blockCentre}, block ${A.layout.block}${A.layout.safe ? ', safe ' + JSON.stringify(A.layout.safe) : ''}`);
  ck('page loaded nothing outside the skill folder', A.requests.outsideSkill.length === 0 && B.requests.outsideSkill.length === 0, `${A.requests.total} loads`);
  ck('playwright resolved inside the skill folder', !A.playwright.startsWith('..'), A.playwright);
  ck('contact sheet every 0.25 s', A.contact && fs.existsSync(path.join(ROOT, 'out', `preview-${pre}a`, 'contact-sheet.png')), A.contact && `${A.contact.stills} stills`);
}
const ok = checks.every(c => c.ok);
const md = `# self-test ${ok ? 'PASS' : 'FAIL'} (${dir})\n\n${A && A.syntheticTiming ? '> timing is SYNTHETIC (generated for engine testing, not a real recording)\n\n' : ''}| check | result | detail |\n|---|---|---|\n` + checks.map(c => `| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail} |`).join('\n') + '\n';
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', pre ? `selftest-${pre.slice(0, -1)}.md` : 'selftest.md'), md);
console.log('\n' + md);
process.exit(ok ? 0 : 1);
