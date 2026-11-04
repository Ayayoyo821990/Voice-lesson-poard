# voice-lesson-board

Hand-drawn whiteboard lesson videos timed by a recorded voice. See `SKILL.md` for the contract and the tools.

## Folder

```
SKILL.md            when to use, contract, steps
README.md           this file
package.json        one dependency: playwright 1.64.1
engine/board.html   the page (no colours inside; they come from theme.json)
engine/engine.js    drawing tools, anchors, fixed layout, pure seek(t), margin sensor
scripts/align.js    maps script words onto recognizer word timings
scripts/render.js   renders a lesson (preview or final) + sync table, sensor, contact sheet
scripts/selftest.js renders a lesson folder twice and checks everything (--dir, default example)
scripts/prepare.py  real recording (+ optional script.json) → segments.json + words.json (local faster-whisper)
scripts/check.js    fast pre-render check: builds the lesson, maths, unclear anchors, margins and coverage by real timing
scripts/direct.js   the automatic director: plan.json (steps → teaching patterns, no coordinates) → lesson.json, auto-fit and auto-split
scripts/storyboard.js one picture of every finished board with its sentences, for the teacher to approve before any render
scripts/fidelity.py the teacher's transcript vs the final script: fails when a spoken reason is lost
scripts/pencheck.js the pen on every frame: jumps, two pens at once, blinks, pen during a page turn, pen outside the safe area
scripts/pause.py    classroom versions from the same voice: --after N S (a pause for «وقّف وجرّب»), --slow EACH STEP; writes a new folder
scripts/refine.py   second timing pass: each sentence heard alone with its own text as prompt (any language); only words.json changes
scripts/cover.js    the cover image (1080x1920) for any lesson: a finished board + subject, title and steps in a card
scripts/series.py   a long lesson → a series of parts cut between steps, each a full lesson folder
scripts/still.js    stills of a lesson at given seconds, side by side (no video)
library/sketches/   drawings in named parts for label_parts / vocab (plant, apple, egg)
scripts/worksheet.js the printable A4 worksheet (PDF) from the same lesson: fill-in boards, try-it, mistake, practice, answer key
scripts/synthetic.js makes SYNTHETIC test timing + click track from <dir>/script.json (engine tests only)
fonts/              PlaypenSansArabic-Bold.ttf + OFL.txt (SIL Open Font License)
example/            voice.mp3, segments.json, words.json, lesson.json, theme.json (real recording)
example2/           script.json, lesson.json, theme.json + SYNTHETIC segments.json, words.json, voice.wav
example3/           example2 in style v2 (grid paper, marker pen, highlight, owl mascot); same SYNTHETIC timing
example4/           order of operations with expr, flow layout and two scenes; SYNTHETIC timing
example5/           column + with carrying and column − with borrowing; SYNTHETIC timing
proposals/          science / math / arabic / english proposals, each with its own theme (make_proposals.py writes them)
lessons/            one folder per teacher lesson (made by following SKILL.md › Working with a teacher)
out/                generated
```

## External requirements (nothing else is used)

| requirement | version tested | notes |
|---|---|---|
| Node.js | 24.19.0 | ≥ 18 should work |
| npm | bundled with Node | only to install the one dependency into `./node_modules` |
| Playwright package | 1.64.1 | installed into this folder; the renderer refuses a copy from a parent folder |
| Chromium headless shell cached by Playwright | chromium_headless_shell-1243 | looked up in `PLAYWRIGHT_BROWSERS_PATH`, `%LOCALAPPDATA%\ms-playwright`, `~/.cache/ms-playwright` or `~/Library/Caches/ms-playwright`; the skill never downloads it |
| ffmpeg on PATH | 9.0.2 | needs libx264, aac and drawtext |
| Python + faster-whisper (optional) | Python 3.12, faster-whisper 1.2.1, model large-v3 in the local Hugging Face cache | only for `scripts/prepare.py` (recording → segments.json + words.json); loaded with `local_files_only`, never downloaded |

## Commands (run inside this folder)

```bash
npm install --offline
```

(uses the local npm cache only; on a machine without it, `npm install` downloads the playwright package — never run `npx playwright install` here)

```bash
node scripts/selftest.js
```

```bash
node scripts/selftest.js --dir example2
```

```bash
node scripts/render.js --report
```

```bash
node scripts/synthetic.js --dir example2
```

(rewrites example2's synthetic `segments.json`, `words.json`, `voice.wav` from `script.json`)

```bash
node scripts/render.js --mode final --tag final
```

Other inputs: `--dir` (folder holding all five; audio is `voice.mp3`, else `voice.wav`), or `--lesson`, `--theme`, `--segments`, `--words`, `--audio` one by one (paths inside this folder).

## Making segments.json and words.json for a new recording

Automatic (recommended):

```bash
python scripts/prepare.py --dir example5
```

By hand, if needed:

Find the pauses with ffmpeg, then write one entry per sentence (`id`, `text`, `start`, `end`, optional `inner_pauses`) using only detected times:

```bash
ffmpeg -hide_banner -nostats -i example/voice.mp3 -af silencedetect=noise=-35dB:d=0.25 -f null -
```

## Outputs

`out/storyboard-<dir>/storyboard.png` (boards + sentences, for approval) · `out/worksheet-<dir>/worksheet.pdf` (+ `worksheet-preview.png`).

`out/preview-<tag>/`: `video.mp4` (voice muxed, AAC), `result.json`, and with `--report`: `sync.md` / `sync.json`, `sensor.md`, `contact/` + `contact-sheet.png`. `out/selftest.md` holds the self-test verdict for `example`, `out/selftest-<dir>.md` for other folders (marked when the timing is synthetic).
