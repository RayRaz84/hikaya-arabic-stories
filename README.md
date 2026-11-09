# حكاية — Arabic through stories

A static Arabic reading website with six graded stories, English translations, optional diacritics, vocabulary glosses, comprehension questions, and reading progress saved on the reader's device.

## Run locally

No dependency installation or build step is required. From the repository root:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000.

## Files

- `dist/index.html`: page layout and illustrations.
- `dist/style.css`: responsive styles, including the pure white page background.
- `dist/app.js`: stories and reading interactions.
- `.openai/hosting.json`: existing Sites project identity and static output directory.

## Audio

This snapshot uses the browser's Arabic speech synthesis. ElevenLabs recordings have not yet been added to the project. Do not place API keys in browser code or commit credentials.

## Hosting

The current site is hosted at https://hikaya-arabic-stories-nov8.grittycedar3.chatgpt.site.

This repository is a source copy of Sites commit `230fcc6ed2353dffa9a12fa5236493dbea24f332`. GitHub pushes are not automatically synchronized with Sites. Serve `dist/` when deploying to another static host.
