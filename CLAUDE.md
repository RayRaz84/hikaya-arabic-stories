# Hikaya

Static Arabic story site. `dist/` is served as-is: `index.html`, `style.css`, `app.js` (classic script, no build), story content in `dist/content/`.

## Commands
- `node scripts/validate.mjs` — validate story files, rebuild `dist/content/index.json`. Run after any content change.
- `node tests/e2e.mjs` — browser checks (needs Playwright + Chromium).
- `python3 -m http.server 8000 --directory dist` — local preview.

## Rules
- Content lives only in `dist/content/`; never hard-code story text, translations, questions or vocabulary in `app.js` or `index.html`.
- Content decisions come from `docs/language-guidelines.md` and `docs/narrative-quality-standards.md`. Fully vowelled Arabic; ليس عنده for negated possession; no fixed story structure; repetition only when meaningful.
- Never write Arabic story content yourself and present it as approved: mark it `contentState: "sample"`.
- Interface text is Arabic; activity instructions are English.
- No real-audio controls without a file; device speech synthesis must stay labelled as automatic. Highlight sentences only from `timing.verified: true`.
- Typed answers ignore vowel marks; other spelling variants are merged only if `answerRules` says so.
- Every Arabic element is RTL; English inside it gets `lang="en" dir="ltr"`. No letter-spacing on Arabic.
