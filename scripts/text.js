// Text helpers shared by the browser and scripts/validate.mjs. No DOM access here.

// Arabic and Latin punctuation that may trail or lead a token.
const PUNCT = '.,!?;:،؛؟…"\'«»()[]{}-–—';

/** Split a sentence into whitespace-delimited tokens. Vocabulary anchors index into this array. */
export function tokenize(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

/** Separate leading/trailing punctuation from a token so anchors wrap only the word. */
export function splitPunctuation(token) {
  let start = 0;
  let end = token.length;
  while (start < end && PUNCT.includes(token[start])) start++;
  while (end > start && PUNCT.includes(token[end - 1])) end--;
  return { lead: token.slice(0, start), word: token.slice(start, end), trail: token.slice(end) };
}

// Unicode ranges for Arabic harakat, tanween, shadda, sukun, dagger alif and Quranic marks.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/**
 * Normalize a typed answer according to a configurable rule set.
 * Every option defaults to off except trimming, so spelling variants are NOT merged unless configured.
 */
export function normalizeAnswer(text, rules = {}) {
  let s = String(text ?? '');
  if (rules.collapseSpaces !== false) s = s.replace(/\s+/g, ' ').trim();
  if (rules.trimPunctuation !== false) {
    s = s.split(' ').map((t) => splitPunctuation(t).word).filter(Boolean).join(' ');
  }
  if (rules.stripDiacritics) s = s.replace(DIACRITICS, '');
  if (rules.stripTatweel) s = s.replace(TATWEEL, '');
  if (rules.unifyAlef) s = s.replace(/[أإآٱ]/g, 'ا');
  if (rules.unifyTaMarbuta) s = s.replace(/ة/g, 'ه');
  if (rules.unifyYa) s = s.replace(/ى/g, 'ي');
  return s;
}
