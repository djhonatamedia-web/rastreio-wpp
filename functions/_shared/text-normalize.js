// Lowercase + strip diacritics, so keyword matching doesn't care about
// accents or capitalization ("Agendado com Sucesso" === "agendado com
// sucesso" === "AGENDADO COM SUCESSO"). Builds the combining-marks range
// (U+0300-U+036F) from code points instead of writing accent characters
// literally in source, to avoid any editor/encoding mangling.
const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;
const COMBINING_MARKS = new RegExp(
  '[' + String.fromCodePoint(COMBINING_MARKS_START) + '-' + String.fromCodePoint(COMBINING_MARKS_END) + ']',
  'g'
);

export function normalize(text) {
  return (text || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}
