# Story format and publishing

Each story is one JSON file in `dist/content/stories/<slug>.json`. The site reads it; no page code changes are needed to add a story. Language rules: [language-guidelines.md](language-guidelines.md). Narrative rules: [narrative-quality-standards.md](narrative-quality-standards.md).

## Fields

| Field | Notes |
| --- | --- |
| `id`, `slug` | Stable id (`story-0002`) and URL name; the file name must be `<slug>.json` |
| `contentVersion` | Integer. Increase it whenever a published story changes; learners' "read" marks for older versions stop counting |
| `status` | `draft`, `review`, `published` (only `published` appears in the library) |
| `contentState` | `approved` or `sample` (sample shows a notice in the reader) |
| `title` | `ar` (fully vowelled), optional `en` |
| `description` | `ar` shown on the card and in the reader; optional `en`. Must not reveal the ending |
| `level`, `topics`, `collections` | Ids from `dist/content/config.json` |
| `readingMinutes` | Shown on the card |
| `cover` | `src` (image path under `dist/`, or `null` while pending) and `alt` |
| `textVariants`, `defaultVariant` | `["full"]` and `"full"`: all text is fully vowelled |
| `readings` | The versions (Story A, B, C), each with `label` (e.g. `القصة أ`), optional `audio.src`, and `paragraphs` → `sentences` |
| sentence | `id` (unique, e.g. `a-s1`), `text.full`, `translation` (English), optional `audio.src`, optional `timing` `{start, end, verified: true}` |
| `vocabulary` | Entries with `id`, `headword.full`, `gloss`, optional `note`, `image`, `audio`, `transliteration`, `frequencyRank`, and `anchors` |
| anchor | `{sentence, tokens: [start, end)}`. Tokens are the sentence's space-separated words, counted from 0, so `[1, 3]` is the 2nd and 3rd word. Phrases are fine |
| `activities.comprehension` | `instructions` (English) and `items` (below) |
| `production` | Writing section: `instructions` (English), `wordBank`, `starters`, `extraPrompts` `[{id, en, starter}]` (personal response, new ending). `pictures` are stored for later |
| `teacherNotes`, `activities.practice` | Stored for later; this site does not show them yet. Flashcards are built from `vocabulary` |

Question items (`items`), each with `id`, `explanation` (English) and `evidence` (sentence ids):

- `choice`: `prompt`, `options` `[{id, text}]`, `answer` (an option id)
- `truefalse`: `statement`, `answer` (true/false), `correction` (required when false)
- `sequence`: `prompt` (English), `steps` in the correct order
- `shortanswer`: `prompt`, `accepted` (list), `rules` (`"default"`), optional `hint`. Vowel marks are ignored; ة/ه, أ/ا and ى/ي are not merged unless the rule set says so

## Publishing workflow

1. Write the story following the NQS workflow; deliver text A/B/C, translations, vocabulary, questions, pictures and audio.
2. An editor scores it against NQS (85+, all five integrity tests, 4/5 on motivation, cause and effect and ending).
3. Copy an existing story file, fill it in, keep `status: "draft"`.
4. Run `node scripts/validate.mjs`. Fix every error (missing fields, duplicate ids, broken references, missing answers, missing files). It also rebuilds `dist/content/index.json`, the list the library reads.
   It also checks the language rules: versions A, B and C with 40–60 / 80–120 / 150–220 words, every Arabic word vowelled (interface labels and typed accepted answers excepted), and no ما عند… (use ليس عند…). These are warnings on a draft and errors on a published story, so a story that breaks them cannot go live. Possible connectors other than لكن، لأن، الآن، جدًا، ثم (for example أو، عندما، و + noun) are always warnings, because a listed word can be a preposition in context.
5. Preview privately at `/?preview=<slug>` (or `/#preview-<slug>`). Published stories have their own link: `/#story-<slug>`.
6. After approval set `status` to `published` and `contentState` to `approved`, run the validator again, and deploy `dist/`.

Draft files are still downloadable by anyone who guesses their address, because this is a static site. Keep unreviewed drafts out of the deployed folder if that matters.
