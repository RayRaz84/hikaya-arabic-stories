# Hikaya: rules for every agent (Claude, ChatGPT/Codex) and contributor

Static Arabic story site. `dist/` is served as-is: `index.html`, `style.css`, `app.js` (classic script, no build), story content in `dist/content/`. Every push to `main` deploys to https://rayraz84.github.io/hikaya-arabic-stories/ through `.github/workflows/pages.yml`.

## Working together
- Never push to `main`. Work on a branch named `<agent>/<task>` (for example `claude/text-size`, `chatgpt/story-2`) and open a pull request. The owner merges.
- Before starting, read `docs/tasks.md`. Only take tasks assigned to you; set the task to "In progress" with your branch name in the same pull request.
- Stay inside your task's files. Site code (`dist/app.js`, `dist/style.css`, `dist/index.html`, `scripts/`, `tests/`) belongs to Claude's tasks; story content and illustrations to ChatGPT's. Ask in the pull request before editing the other side.
- Pull `main` before you start and again before you open the pull request.
- Nothing is approved by an agent. New stories stay `status: "draft"` and `contentState: "sample"` until the owner approves them.

## Commands (run both before every pull request)
- `node scripts/validate.mjs` — validate story files and rebuild `dist/content/index.json`. Commit the rebuilt index.
- `node tests/e2e.mjs` — browser checks (needs Playwright + Chromium).
- `python3 -m http.server 8000 --directory dist` — local preview; drafts open at `/?preview=<slug>`.

## Content rules
- Content lives only in `dist/content/`; never hard-code story text, translations, questions or vocabulary in `app.js` or `index.html`. Format: `docs/story-format.md`.
- Content decisions come from `docs/language-guidelines.md` and `docs/narrative-quality-standards.md`: fully vowelled Arabic; ليس عنده for negated possession; connectors only لكن، لأن، الآن، جدًا، ثم; versions A/B/C of 40–60 / 80–120 / 150–220 words; no fixed story structure; repetition only when meaningful.
- Interface text is Arabic; activity instructions are English.

## Site rules
- No real-audio controls without a file; device speech synthesis must stay labelled as automatic. Highlight sentences only from `timing.verified: true`.
- Typed answers ignore vowel marks; other spelling variants are merged only if `answerRules` says so.
- Every Arabic element is RTL; English inside it gets `lang="en" dir="ltr"`. No letter-spacing on Arabic.
- Never put API keys or credentials in the repository or in browser code.
