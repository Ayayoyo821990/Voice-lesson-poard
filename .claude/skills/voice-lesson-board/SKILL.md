---
name: voice-lesson-board
description: Turn a teacher's recorded explanation (audio or video, Arabic or English) into a hand-drawn whiteboard lesson video for primary school — maths, science, Arabic, English or any visual lesson — vertical 1080x1920 for Reels/TikTok/Shorts, where every drawing starts on the exact word that says it. Includes the storyboard for the teacher to approve, «وقّف وجرّب» quizzes (choice, true/false, fill the blank) with a timer, «الغلطة المشهورة», a slow version, a series of reels, a cover image and a printable A4 worksheet from the same lesson. Use whenever a teacher (or someone making lessons for teachers) has a recording, a video of a lesson, or a lesson script and wants an explainer drawn by a pen, a whiteboard/sketch lesson, a worksheet or a cover for it — even if they never say "whiteboard" or "skill". Not for editing live talking-head footage.
---

# Voice Lesson Board

The teacher's voice decides everything: how long the video is and when each thing is drawn. You write a **plan** (steps → teaching patterns, tied to the words that say them), never coordinates; the director lays it out, the engine draws it with a pen, the same way every time, and the checks prove it.

Teachers are not programmers: talk about the lesson, the boards and the words — never about JSON, paths or tools.

## Rules

- **Storyboard before any video**, then **one preview** (540x960), then the final 1080x1920 **only after the user says "go"**.
- Nothing the teacher explained is lost: every reason he gives keeps a drawing (coverage 100 %, `fidelity.py`).
- Generating a voice (ElevenLabs) costs credits: ask before each generation.
- Work inside this skill folder: every script refuses paths outside it. Lessons live in `lessons/<name>/`, everything generated in `out/`.
- No downloads: Playwright uses the cached Chromium (never `playwright install`); faster-whisper uses its local model only.

## The voice: three cases (ask which one at the start)

1. **His own recording, his own voice.** Use the recording as `voice.mp3` and follow the path below.
2. **He recorded, but wants a generated voice** (noisy room, long pauses, he does not like his voice): run `prepare.py` on his recording without a script → `script.json`; clean it with him (keep every explanation, remove repetitions and slips, run `fidelity.py`); then generate the voice from the clean script with the ElevenLabs connector, as step 3 of case 3.
3. **No recording, only a text.** Split the text into `script.json` sentences, then with the ElevenLabs connector: list the voices (filter by language, gender, accent) and let him pick one by name; **say the cost and ask before each generation**; generate the whole script in one go; save it as `lessons/<name>/voice.mp3` and run `prepare.py` with that `script.json` (exact times, as for a real recording). If the connector is not connected, tell him to connect ElevenLabs in Claude's connector settings, or to record himself.

Never clone a real person's voice without that person's permission. A generated voice can be regenerated (another voice, slower) without touching the plan: the director re-times everything from the new `segments.json`.

## The path with a teacher

1. **Recording.** Make `lessons/<name>/` with `voice.mp3` (from a video: `ffmpeg -i in.mp4 -vn -ac 1 -q:a 2 lessons/<name>/voice.mp3`) and a `theme.json` (copy one from `themes/`: science, math, math-squared, arabic, english). Optional `script.json` `{ "sentences": [...] }` if the teacher has the text.
2. **Words and times.** `python scripts/prepare.py --dir lessons/<name> [--language en]` (no script → it writes `script.json` from the recording, for the teacher to correct), then `python scripts/refine.py --dir lessons/<name>` (each sentence heard again with its own text: exact times for the unsure words).
3. **Plan.** Write `lessons/<name>/plan.json`: `subject`, `lang` ("ar" | "en"), `title`, `steps: [{ title, hero | hero_text, beats: [...] }]`. Each beat is a teaching pattern with anchors: `"7"` sentence 7 starts · `"7:word"` that word · `"7:word#1"` its 2nd time · `"7$"` sentence 7 ends. Every sentence must anchor at least one beat. Patterns:
   - any subject: `greet`, `title`, `say`, `celebrate`, `table`, `sequence`, `cycle`, `label_parts` (a drawing from `library/sketches/`), `word_parts`, `vocab`, `underline`, `erase`, `common_mistake`, `try_it` (`kind`: choice | true_false | blank), `mark`, `note`; `plan.summary` adds «الخلاصة»;
   - maths: `write`, `answer`, `column`, `fraction_pie`, `divide_both`, `two_columns`, `intervals`, `intersection`, `check_on_line`, `sign_flip`, `tags`, `rule`, `rule_arrow`, `distribute_square`.
   Options and examples of each: `references/REFERENCE.md`. Working plans to copy from: `lessons/science` (label_parts), `lessons/arabic` and `lessons/english` (table), `lessons/patterns-demo` (cycle, vocab, word_parts, summary), `lessons/try-demo` (quizzes), `lessons/mistake-demo` («الغلطة المشهورة»).
4. **Direct and check.** `node scripts/direct.js --dir lessons/<name>` (writes `lesson.json`, fits or splits boards by itself, runs the checks) — must end in **PASS**. Then `node scripts/pencheck.js --dir lessons/<name>` — every line must be 0.
5. **Storyboard to the teacher.** `node scripts/storyboard.js --dir lessons/<name>` → `out/storyboard-…/storyboard.png`. Send it; take changes in his words («لوح ٣: كبّر الرسمة») and edit the plan, then step 4 again.
6. **One preview.** `node scripts/render.js --dir lessons/<name> --tag <name> --report` → `out/preview-<name>/video.mp4` (sync table: max delta ≤ 2 frames). Send it.
7. **After "go".** `node scripts/selftest.js --dir lessons/<name>` (two renders, identical), then `node scripts/render.js --mode final --dir lessons/<name> --tag <name>-final --report` → `out/final-<name>-final/video.mp4`. Tell the user the expected time first if over 10 minutes (about twice the preview time).
8. **Extras from the same lesson** (offer them):
   - `node scripts/cover.js --dir lessons/<name>` → cover.png for the profile grid;
   - `node scripts/worksheet.js --dir lessons/<name>` → an A4 PDF: fill-in boards, quizzes, practice (`plan.worksheet.practice`), answer key;
   - `python scripts/pause.py --dir lessons/<name> --out lessons/<name>-try --after N 4.5` → room for a «وقّف وجرّب» timer after sentence N; `--slow 0.6 1.6` → the slow version;
   - `python scripts/series.py --dir lessons/<name> --max 75` → a series of reels cut between steps («الجزء ١ من ٣»).

`node scripts/still.js --dir lessons/<name> --t 4.2,7.6` shows any moment without a video.

## When a check fails

| message | what to do |
|---|---|
| `coverage FAIL: sentence(s) …` | give each listed sentence a beat (or `plan.exempt` with a reason) |
| `BOARD_TOO_TALL … cannot be split` | make a beat smaller, or move beats to another step |
| `anchor "…": «word» is not in sentence N` | copy the word exactly as written in `script.json` (with its harakat and prefixes: «وبترجع») |
| `idle: … stretches` | add a beat in that stretch (the engine fills short gaps by itself) |
| `drawn without a pen: …` | anchor that drawing on a later word, or shorten what comes before it |
| pencheck not 0 | read which drawing, then move its anchor or split the board |

## Needs

Node 18+ (`node_modules` with Playwright 1.64.1 is included) · the cached Chromium headless shell · ffmpeg · Python 3 with faster-whisper and its local `large-v3` model · optional: the ElevenLabs connector to generate a voice.

Folder: `engine/` (the board and the drawing tools) · `scripts/` · `library/sketches/` (drawings in named parts) · `themes/` · `fonts/` · `references/REFERENCE.md` (every pattern, tool and option) · `example/` (the self-test lesson) · `lessons/` (working examples).
