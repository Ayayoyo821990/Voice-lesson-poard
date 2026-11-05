# Voice Lesson Board — full reference

Everything the engine and the director can do, with every option. SKILL.md has the short path; read this when a lesson needs a pattern, a tool or an option not shown there.


The voice decides everything: how long the video is and when each thing is drawn.
You describe the board in `lesson.json`, the look in `theme.json`, and the engine draws it with a pen, frame by frame, the same way every time.

## Working with a teacher — the automatic director (follow this when a teacher brings a recording)

Teachers are not programmers. Talk about the lesson, never about JSON, paths or tools. You write a **plan** (a table), never coordinates.

1. **Get** the recording (or a video: extract its audio with ffmpeg) and one sentence about the problem. Ask once: digits (Western or Arabic-Indic) and, for column sums, which side the sign goes.
2. **Transcribe:** `python scripts/prepare.py --dir lessons/<name>` (no script → it writes `script.json` from the recording). It flags recogniser faults (loops like «4x −2 4x −2…», foreign words, unsure stretches) and transcribes again carefully; check any word it still lists.
3. **Faithfulness (rule: nothing the teacher explained is lost):** keep every reason and every explanation in the teacher's own words and order; remove only repetition and recogniser errors. Keep his raw transcript as `source/transcript-careful.json` and run `python scripts/fidelity.py --dir lessons/<name>` — it FAILS when a passage that carries a reason («عشان», «لازم», «المفروض», «لما»…) is missing. Exempt a passage only with a written reason in `plan.json › fidelity_exempt`.
4. **Write `plan.json`** — steps → beats, each beat a *teaching pattern* anchored to the words that say it (`"7"` = sentence 7 starts, `"7:شرطين"`, `"7:جذر#1"` = its 2nd time):
   | pattern | draws |
   |---|---|
   | `write` | one line of work, pieces cued to words (`cues`, `colors`) |
   | `mark` | highlights part of the hero (`hero:2`) or of a line (`d2:2`) in a meaning colour |
   | `sign_flip` | a term crosses "=": − → + with an arrow |
   | `tags` | two names in their colours (شرط ١ blue · شرط ٢ orange) |
   | `rule_arrow`, `rule` | a rule drawn in a card (√□ → □ ≥ 0, (√□)² = □) |
   | `two_columns` | two conditions side by side, line by line (right = first/blue, left = second/orange) |
   | `divide_both` | the division written as fractions on both sides, the cancel marked |
   | `intervals` | a number line with a ray per interval and the interval written under it |
   | `intersection` | keep the overlap: note, highlighted ray, result in a frame |
   | `distribute_square` | (2√□)² = 2² × (√□)² and 2² = 4 |
   | `check_on_line` | count on the number line (hops 4 → 5 → … → 8), a dot on the answer |
   | `answer` | the solution in a frame with sparkles |
   | `column`, `fraction_pie`, `note` | column sums with carries/borrows; a fraction on a pie; a short drawn sentence |
   | `common_mistake` | «الغلطة المشهورة»: `wrong` written (maths check knows it is wrong on purpose), crossed out at `strike_at`, `right` written at `right_at`; optional `note` |
   | `try_it` | «وقّف وجرّب»: `prompt` + `question`, then a 3-2-1 `countdown` at `count_at` (exact timer, no pen) — put it in a pause made by `pause.py --after` |
   | `underline`, `erase` | a line under `of` (a word or line of work); «امسح»: `of` fades under an eraser sweep |
   **Any subject** (not only maths) — `plan.lang`: `"ar"` (right to left) or `"en"` (left to right: texts, captions, «Step 1 of 3»):
   | pattern | draws |
   |---|---|
   | `greet`, `title`, `say`, `celebrate` | a greeting that fades, a big title, one written sentence or key word, a tick with sparkles |
   | `table` | a comparison: column heads in their colours (`cols: [{head, at, mark_at}]`), rows of cells each on its word |
   | `sequence`, `cycle` | steps joined by arrows, one under the other; a cycle on two rows with the last arrow back to the first (water cycle) |
   | `label_parts` | a drawing from `library/sketches/<name>.json`, each part drawn on its word, its name **beside it** with an arrow (`wash`, `recap_at`) |
   | `word_parts` | one word in coloured pieces (root letters, prefix, ending) with an optional `gloss`; the letters stay joined |
   | `vocab` | a vocabulary card: the word, a library picture, its meaning, an example sentence, framed |
   | `try_it` kinds | `kind: "choice"` (options أ- ب- ج-, `answer` index), `"true_false"`, `"blank"` (`answer` written at `reveal_at`), default a maths question; a ring timer that empties second by second |
   `plan.summary: { items: [[text, "9$"], …], hold: 4 }` adds a last board «الخلاصة» / "Summary" (points on the same anchor come one by one, after the voice). A step may have `hero_text` (words) instead of `hero` (an equation). Labels placed with `near` never sit on each other (the nearest free place) and the next row starts under them.
   Each step has `title`, `hero` (the equation of that step) and `hero_at`/`step_at`. Colours are meanings: `first` (shape, blue), `second` (`shape2` if the theme has it, e.g. green, else the accent), `answer`/`mistake` (the ONE accent). Anchors also take `"7$"` = when sentence 7 ends.
5. **Direct:** `node scripts/direct.js --dir lessons/<name>` builds `lesson.json`: every board gets «الخطوة ك من ن» on top, the hero in a pen frame, the work under it, the same colours on every board; a board too tall is scaled (≥ 80 %, never under the theme's minimum font) or **split by itself** («… (تابع)», never between a beat and the beat that points back at it); drawings are nudged to start after a page turn and trimmed before the next. It FAILS if a sentence has no beat (coverage rule) — add one, or exempt it in `plan.json › exempt` with a reason.
6. **Check:** `node scripts/check.js --dir lessons/<name>` — maths, margins, and **coverage by real timing** (every sentence starts a drawing while it is said).
   **Pen:** `node scripts/pencheck.js --dir lessons/<name>` (under a second) measures the pen on every frame — jumps, two pens at once, drawings that blink, a pen during a page turn, a pen outside the safe area — and must report zero. Director lessons use the *calm pen* (`frame.pen`): pen lifts take time in proportion to the distance, no stroke faster than 1800 px/s at its peak or shorter than 0.25 s, one pen at a time (a drawing waits up to 0.9 s for it), recaps of the hero, step titles and frames on later boards fade in without the pen, and decorations (badge, voice ring, sparkles) never take it. `check.js` lists any new drawing that still had to be drawn without a pen; fix those in the plan (cue a piece to its word, move an anchor, turn the page later).
   **Pedagogy** (also in `check.js`): *idle* — never more than `plan.max_idle` (1.5 s) with nothing new on screen; the engine fills a longer stretch itself with a soft pulse on the newest drawing or title (`frame.idle`), and a page turn counts as something new. *accent* — one emphasis colour, warned when over 35 % of events use it. *density* — a board over 34 drawings is reported (split the step). *coverage* — every sentence starts a drawing (every drawing is tied to a word by its anchor). Boards that are small are scaled **up** to `frame.fit.max_scale` (1.35) within the safe width, with the pen speed cap scaled with them.
7. **Storyboard first:** `node scripts/storyboard.js --dir lessons/<name>` (seconds) → `out/storyboard-…/storyboard.png`: each board finished, numbered, with its sentences (✗ = no drawing). Send it to the teacher; take changes in plain words («لوح ٣: كبّر الخط», «زيد سهم هون») and edit the **plan**, then direct again. No video before the storyboard is approved.
8. **One preview** (`render.js --report`), then the final only after "go".
9. **Classroom versions** (same voice, no new recording): `python scripts/pause.py --dir lessons/<name> --out lessons/<name>-try --after 35 4.5` inserts 4.5 s of silence after sentence 35 (room for a `try_it` countdown); `--slow 0.6 1.6` makes the slow version (0.6 s after every sentence, 1.6 s after each step). It copies the lesson to a new folder and shifts every time; then direct and check that folder.
10. **Timing, more exact (any language):** `python scripts/refine.py --dir lessons/<name> [--language en]` hears every sentence again on its own, with its own text as the prompt, and re-times the words the first pass was unsure of (img8818: 132 → 40 unsure words, drawings on estimated times 51 → 17). Only `words.json` changes; the old one is kept as `words.json.before-refine`.
11. **Cover:** `node scripts/cover.js --dir lessons/<name>` → `out/cover-…/cover.png` (1080x1920; for a landscape lesson a 1920x1080 YouTube thumbnail: the card on the reading side, the board smaller on the other half): a finished board with the subject, title and steps in a card at the top of the centre 3:4 area (`plan.cover: { title, question, board }`).
12. **Series:** `python scripts/series.py --dir lessons/<name> --max 75` cuts a long lesson between steps into balanced parts (`<name>-part1…`), each a full lesson (voice slice, sentences from 1, its steps keep their numbers); the director adds «الجزء ١ من ٣» and an end board «بالجزء الجاي: …». A single long step stays whole (img8818: 23 s + 82 s + 89 s).
13. **Look at a moment:** `node scripts/still.js --dir lessons/<name> --t 4.2,7.6` → stills side by side, no video.
14. **Worksheet:** `node scripts/worksheet.js --dir lessons/<name>` → `out/worksheet-…/worksheet.pdf` (A4): page 1 «كمّل الخطوات» — the same boards with each step's last line hidden behind a dotted box (and its highlight), then «وقّف وجرّب», «الغلطة المشهورة» and «تمرّن لحالك» (`plan.json › worksheet.practice: [{ say, text, answer }]`); last page «الحل كامل» for the teacher.

## What you need (the contract)

| file | what it is |
|---|---|
| `voice.mp3` | the teacher's recording |
| `segments.json` | the script split into sentences, with each sentence's start/end time in seconds (from `ffmpeg silencedetect`) and pauses inside it |
| `words.json` | word timings from a speech recognizer (for example whisper), best effort, with a confidence per word |
| `lesson.json` | what to draw, where, and on which word (see below) |
| `theme.json` | paper, ink, shape and ONE accent colour, the font file, the minimum font size |

All of these sit inside this folder. The renderer refuses any path outside it.

## Steps, in plain words

0. **Timing from a recording, automatically.** Put `voice.mp3` (or `.wav`) and, if there is one, `script.json` (`{"sentences": [...]}`, one entry per sentence, exactly what is read) in a folder (without a script, the recording is transcribed into one for review), then run `python scripts/prepare.py --dir <folder>`. It writes `segments.json` and `words.json` (pauses from ffmpeg, word times from the local faster-whisper model, every script word matched to what was heard) and lists the words it is unsure of. On `example/` it gives the same 7 sentence boundaries as the hand-made file and word times within 0.04 s.
1. **Put the files in.** Copy your five files into a folder inside this skill, like `example/`.
2. **Write the lesson.** In `lesson.json`, list events in drawing order. Each event has a `tool`, its numbers (position, size), an `anchor` and a `dur` (seconds).
   - Anchor to a sentence: `{ "segment": 3 }`.
   - Anchor to a word: `{ "segment": 3, "word": "ربع", "index": 3, "fallback_offset": 1.57 }` (`index` counts words in that sentence from 0). If the word's timing is unreliable, the engine uses the sentence start + `fallback_offset` (or, when it is left out, the time the word was heard) and says so in the sync table.
3. **Preview.** `node scripts/render.js --report` (another folder: add `--dir example2`) makes a small 540x960 preview with the voice, a sync table and a contact sheet. Look at them.
4. **Check.** `node scripts/selftest.js` renders twice and checks everything (list below). For another folder: `node scripts/selftest.js --dir example2`. Fix anything that fails.
5. **Only after the person says "go":** `node scripts/render.js --mode final --tag final` for 1080x1920.

## Tools you can use in lesson.json

**Text** — `title`, `subtitle`, `label`, `text` (Arabic, right-to-left, revealed by the pen, whole words). `"dir": "ltr"` writes English left to right (the font has Latin letters); `"color": "accent"` (or `shape`) colours a word.

**Subject and drawings** — `badge` (`text`, `color`: the subject name in a pen-drawn pill at the top of the video, frame coordinates, e.g. «علوم», «رياضيات», «لغة عربية», «English») ·
`sketch` (`paths`: SVG path data with absolute `M L C Q Z` only, drawn by the pen in order; `x, y` top-left and `scale`, or `frame_of` an earlier sketch so the parts of one drawing line up; each part can have its own anchor; arrows and highlights can point at it).

**Numbers and symbols** (all pen strokes, written left to right, seeded wobble) —
`digit` (one glyph: `char`) · `plus` · `equals` · `number` (a whole string: `"12"`, `"0.6"`, `"60%"`, `"3×4=12"`; operators inside a number are drawn smaller) ·
`fraction` (numerator, line, denominator; multi-digit numbers are fine, the line widens) ·
`line` (a written line of symbols with its label; the label must come first, the engine refuses otherwise).
Glyphs: `0-9 + - = × ÷ % .` and Arabic-Indic `٠-٩ ٫ ٪`. Set `"digits": "arabic-indic"` on the lesson or on one event to write ٣٫٥ instead of 3.5 (default `latin`).

**Expressions** — `expr` writes a whole expression from one string, laid out as maths:
`"(3+5) ÷ 2^2 + 1/2"`, `"2 3/4"` (mixed number), `"7 × □ = 21"` (blank box), `"12 > 9"`, `"3.5 + 1.25 = ?"`.
`a/b` is a stacked fraction (brackets around a or b are dropped), `a^b` a power, `*` → ×, `:` → ÷.
Each top-level term or operator is its own timed piece: piece 0 starts on `anchor`; `cues: [null, {anchor}, …]` start later pieces on their own words; a piece without a cue follows the one before.
Algebra: `x` (as in `8x`, `-2x`), `√(…)` (drawn with its bar), `≥ ≤ ∈`, intervals `[4, ∞)` and sets `{8}`; `2√(…)` and `4(…)` multiply without a sign. Give the lesson `"variables": { "x": 8 }` (the answer) and every equation or inequality with x is checked by putting the answer back in.
Optional: `h` (default 100), `names` (ids for the pieces, for arrows and highlights; default `<id>.<k>`), `durs`, `colors`, `align` (`left`/`center`/`right` around `x`), `column` (rows with the same column share one left edge, the widest centred: aligned solution steps).

**Column arithmetic** — `column` (`op`: `+`, `-` or `×`; `a`, `b`: whole numbers up to 7 digits; `h` default 90). The engine computes the answer, the carries and the borrows itself, so they are always right.
Steps, in teaching order: `a`, `b`, `sign`, `rule`, then per column from the units: `+` → `r0` (answer digit), `k1` (carry into the next column), `r1`, …; `-` → for a borrow chain `x2 n2 x1 n1 x0 n0` (cross a digit, write its new value above, e.g. 403 → 3 9 13), then `r0`, `r1`, …; `×` by one digit → like `+` (carries above a); `×` by several digits → partial products `p0`, `p1`, … (with place-holder zeros), `sign2`, `rule2`, then `r0`, `r1`, … of the sum.
`cues: { "r0": {anchor}, "k1": {anchor} }` starts a step on its own word; a step without a cue follows the one before. Event ids are `<id>.<step>` (for highlights). Options: `x` (centre), `y` (top) or the flow layout, `sign_side` (`left`, default, or `right`), `digits`, `zeros: false`, `mark_color` (carries/borrows, default `accent`), `durs`.

**Bar model** — `bar` (N equal parts) · `divider` · `shade` (pen hatching over parts) · `frame_parts` (outline around parts).

**Pie** — `pie` (`x, y, r, parts`; circle then radii; parts run clockwise from `start_deg`, default -90 = top) · `pie_shade` (`pie, part, count`).

**Area model** — `grid` (`x, y, w, h, rows, cols`; outer rectangle then inner lines) · `grid_shade` (`grid, row, col, rows, cols`: a block of cells).

**Number line** — `number_line` (`x, y, w, from, to, step`, `major_every`, `arrow`; axis + ticks are one event, optional `labels: { values: ["0", "1"], h }` are a second event right after, or on their own `anchor`) ·
`hop` (`line, from, to`; an arc arrow above the line, default colour `accent`; optional `text: { text: "+0.3", anchor }` above the arc).

**Style and character** (all optional) — `highlight` (`of`: one id or a list; a translucent marker swash behind them, default `accent`) ·
`voice_wave` (`x, y, size`; an abstract speaker with no face: a pen-drawn ring whose bars rest as dots and move while a word is spoken; frame coordinates, stays across boards) ·
`mascot` (`x, y, size`; an owl drawn by the pen, then it blinks, looks at whatever is being drawn and opens its beak on every spoken word).
In `theme.json`: `"pen"`: `"marker"` or `"chalk"` (default: a dot); `texture.grid: { size, color, width, opacity }` gives squared notebook paper, with `"kind": "lines"` ruled paper, and `margin_x` / `margin_color` an exercise-book margin line.
Theme proposals (one per subject, in `proposals/*/theme.json`): science = ruled paper, green + orange; maths = squared paper, blue + orange; Arabic = plain warm paper, terracotta + teal; English = green chalkboard, chalk white + yellow.

**Direction (finish)** — `wash` (`of`: a sketch, or a pie with `part`/`count`; a soft watercolour fill that blooms from the middle, under the pen lines; `color`, `opacity`) ·
`sparkle` (`of`: an element; short pen strokes burst around it, then fade — use it right after the final `check`) ·
`captions` in lesson.json (`{ "size": 46, "dir": "rtl" }`, optional `top`): the spoken sentence at the TOP, under the subject badge, the current word in the accent colour, words still to come faded, and a thin progress line under it. The board is centred in the space left under the captions.

**Safe area (Instagram Reels / TikTok)** — `frame.safe: { "top": 270, "bottom": 480, "left": 70, "right": 140 }` keeps every element out of the app's header, caption/buttons area and right-hand action buttons, on every frame (the sensor checks each side; its number = `frame.margin` + the slack). The badge and the voice ring sit just inside the top edge; captions under them; the board below the captions. A board taller than the space left is refused with its size and the space available — shrink it or split it with `scene`. Sources disagree on exact numbers (≈250–270 top, 320–670 bottom); 270/480/140 is a cautious middle — check one real upload.

**Marks** — `circle` · `arrow` (from a label or element to an element; the tip stops `gap` px away from it, default 12) · `check`.

**Layout without coordinates** — set `"layout": { "flow": true, "gap": 60 }` in lesson.json. Then `title`/`label`/`text`, `expr`, `pie`, `grid` and `check` that have no `y`/`top` are stacked as rows from the top; `"beside": true` puts one on the same row as the previous (give its `x`). The finished block is still centred once.

**Several boards** — a `scene` event (`anchor`, `fade`, default 0.35 s) turns the page: everything drawn so far fades out and later events go on a fresh board, centred on its own. A drawing that would cross a page turn is refused. The `mascot` stays across boards (frame coordinates).

Placing: `number` takes `x, y` or `at`: `{ "line": "nl", "value": 0.6 }` (under that tick), `{ "grid": "g", "row": 0, "col": 2 }` (a cell centre; leave out `row` for above the grid, `col` for left of it), `{ "pie": "p" }`, each with optional `dx, dy`.
Shapes a tool refers to (`bar`, `pie`, `grid`, `line`) must come earlier in `events`.

Every drawing tool: pen strokes revealed by `stroke-dashoffset`, a pen tip that follows the path, colours from theme roles only (`ink`, `shape`, `accent`), an `anchor` (sentence or word) and a `dur`, and a `group` (required on the new tools) naming what the margin sensor measures.

## Rules the engine keeps for you

- `seek(t)` is a pure function of time: no timers, no CSS transitions, no `Math.random` (seeded only). Same input → same video, byte for byte.
- Layout is fixed: the final block is centred once at 50 % of the height and nothing ever moves.
- Every element stays at least `frame.margin` px (60) from the edges on every frame, or the render fails.
- Arabic: `direction: rtl`, `letter-spacing: 0`, `line-height: 1.9`, whole words only. Numbers are drawn as pen strokes, left to right.
- Text smaller than `theme.minFontPx` is refused.

## What the self-test checks

`scripts/check.js` (seconds, no video): the lesson builds, maths, unclear anchors, margins sampled every 0.25 s.
`scripts/selftest.js`: two renders give the same hash · maths in every `expr` is true · margin sensor (60 px) · vertical drift = 0 · sync delta ≤ 2 frames · every line's label before the line · arrow gaps · font minimum · block centred · nothing loaded from outside this folder · Playwright resolved from this folder · contact sheet every 0.25 s.

## Examples

- `example/` — 1/4 + 2/4 = 3/4 on a bar, with a real teacher recording.
- `proposals/` — four primary lessons with a subject badge and their own theme: `science` (parts of a plant, pen-drawn), `math` (quarters of a pizza), `arabic` (اسم فعل حرف), `english` (a or an?). Maths, Arabic and English use ElevenLabs female voices timed by `prepare.py`; science has **synthetic** timing until it gets a voice. `proposals/make_proposals.py` writes their lessons and themes.
- `lessons/img8818-try/` — img8818 with a 4.5 s pause after sentence 35 and a «وقّف وجرّب» beat (x = ? → 3-2-1 → x = 8 on the teacher's word); `lessons/img8818-slow/` — its slow version (222.6 s, 9 boards).
- `lessons/science/`, `lessons/arabic/`, `lessons/english/` — the three proposals directed from a plan (no coordinates): plant parts with `label_parts`, اسم/فعل/حرف and a/an as `table`. Real voices, re-timed with `refine.py`.
- `lessons/patterns-demo/`, `lessons/try-demo/` — cycle, vocab card, word_parts, summary; choice / true-false / blank quizzes. **Synthetic** timing.
- `lessons/img8818-try-part1…3/` — img8818-try cut into a series by `series.py`.
- `lessons/mistake-demo/` — «الغلطة المشهورة»: 1/4 + 2/4 = 3/8 crossed out, then 3/4 and a pie. **Synthetic** timing.
- `lessons/img8818/` — a real teacher video (`audio/IMG_8818.MP4`, 5 min, Egyptian dialect) turned into a 2-minute board: transcript cleaned, voice regenerated (ElevenLabs Hany), pauses shortened, four boards (√(8x) − 2√(4x−16) = 0 → {8}). `make_lesson.py` writes its lesson.
- `example5/` — grade 4: 47 + 38 with carrying, then 403 − 128 with borrowing across a zero, on two boards. Same **synthetic** timing caveat.
- `example4/` — a grade-6 order-of-operations problem, `(3+5) ÷ 2² + 1/2 = 2½`, written with `expr` on two boards, placed by the flow layout. Same **synthetic** timing caveat.
- `example3/` — the same lesson as example2 in style v2: notebook paper, marker pen, highlights and the owl. Same **synthetic** timing.
- `example2/` — 3/5 = 6/10 = 0.6 = 60 % on a pie, a grid and a number line. **Its timing is synthetic** (`scripts/synthetic.js` made `segments.json`, `words.json` and a click track `voice.wav` from `script.json`). It tests the engine; it is not a lesson for students until a real recording replaces those three files.

## Limits (be honest with the user)

**Landscape (`plan.format: "landscape"`, 1920x1080 for YouTube / a class screen):** the same patterns, laid out in the middle of the wide frame; tables, sequences and summaries use the full width. The board area is shorter (about 745 px under the header and captions), so the director splits boards more often and may scale a board down to 70 %; text never goes under 36 px (`plan.min_font`), which on a wide screen reads like 48 px on a phone. `plan.safe` still overrides the safe area. Long lessons (10–15 min) work; tell the teacher the render time first (measured on a cloud machine: about 4–5 × the length for the preview and 14 × for the final, e.g. a 15-minute lesson ≈ 1 h 10 min preview + 3 h 30 min final; a laptop may be faster or slower), and keep the computer awake.

Still specific to grade 4-6 arithmetic:
- Only the glyphs listed above are hand-drawn: no letters/variables (x, n, س), no units (cm, kg), no `≤ √ π`, no Latin words. Any other character is refused.
- `column` does + − × of whole numbers; no long division yet (its layout differs between countries), no decimals in columns, no carries shown inside multi-digit multiplication (only the partial products and the sum).
- `expr` covers one-line expressions with fractions, mixed numbers, powers, brackets and blanks; not long column arithmetic (carrying, long division), not roots or equations over several lines in one event (use one `expr` per step with `column`).
- Flow layout stacks rows top-down with `beside` for side by side; it does not wrap long rows or choose sizes for you; `number_line`, `bar` and `line` still need coordinates.
- `pie` parts are equal; `grid` cells are equal; shading covers convex blocks only (one sector or one rectangle of cells per event).
- No geometry tools (angles, polygons with lengths), no coordinate plane, no tables or bar charts.
- Arabic text is single-line, typeset in the theme font and revealed by a wipe (not stroke by stroke); a true Arabic pen hand needs its own stroke font.
- `try_it` needs a real pause in the voice; without `pause.py` the countdown overlaps the teacher.
