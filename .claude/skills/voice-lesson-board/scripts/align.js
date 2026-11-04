// align(segments, rawWords) → script words with timings.
// segments: segments.json ("segments": [{id, text, start, end, inner_pauses?}]) — times from ffmpeg silencedetect
// rawWords: words.json ("words": [{word, start, end, confidence}]) — e.g. whisper, best effort
// Rules (simple on purpose):
// - a whisper word belongs to the segment that contains its END time (+0.3 s tolerance)
// - if there are more whisper words than script words, adjacent low-confidence words (< 0.6) are merged
// - a word that overlaps a detected pause is snapped to the pause edge (whisper often swallows pauses)
// - reliable = confidence >= 0.8 and duration >= 0.1 s after snapping
function align(segments, rawWords) {
  const silences = [];
  segments.forEach((s, i) => {
    if (i) silences.push([segments[i - 1].end, s.start]);
    for (const p of s.inner_pauses || []) silences.push(p);
  });
  const out = [];
  for (const s of segments) {
    const script = s.text.split(/\s+/).filter(Boolean);
    const toks = rawWords.filter(w => w.end > s.start && w.end <= s.end + 0.3).map(w => ({ ...w, src: [w.word] }));
    while (toks.length > script.length) {
      const i = toks.findIndex((w, k) => k < toks.length - 1 && w.confidence < 0.6 && toks[k + 1].confidence < 0.6);
      if (i < 0) break;
      const a = toks[i], b = toks[i + 1];
      toks.splice(i, 2, { word: a.word + ' ' + b.word, start: a.start, end: b.end, confidence: Math.min(a.confidence, b.confidence), src: [...a.src, ...b.src], merged: true });
    }
    if (toks.length !== script.length) throw new Error(`segment ${s.id}: ${script.length} script words but ${toks.length} timed words — fix words.json or the script text`);
    script.forEach((text, i) => {
      const w = toks[i];
      let st = w.start, en = w.end; const note = [];
      for (const [a, b] of silences) {
        if (Math.min(en, b) - Math.max(st, a) <= 0.05) continue;
        if (en - b >= a - st) { note.push(`start ${st.toFixed(3)}→${b.toFixed(3)}`); st = b; }
        else { note.push(`end ${en.toFixed(3)}→${a.toFixed(3)}`); en = a; }
      }
      out.push({ seg: s.id, i, text, heard: w.src.join(' '), confidence: w.confidence, start: +st.toFixed(3), end: +en.toFixed(3),
        reliable: w.confidence >= 0.8 && en - st >= 0.1, snapped: note.length > 0, merged: !!w.merged, note: note.join('; ') });
    });
  }
  return out;
}
module.exports = { align };
