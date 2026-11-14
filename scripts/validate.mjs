#!/usr/bin/env node
// Validates every story record in content/stories and writes content/index.json
// (the public library index: published stories and preview cards only).
//
// Usage:
//   node scripts/validate.mjs            validate and write the index
//   node scripts/validate.mjs --check    validate only, write nothing
//   node scripts/validate.mjs --dir <d>  validate another stories directory (used by tests)
//
// Exit code 1 if any error is found. Warnings never fail the run.

import { readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize, splitPunctuation } from './text.js';

// Paths in story files (images, audio) are relative to dist/, the folder that is served.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const dirArg = args.indexOf('--dir');
const storiesDir = dirArg >= 0 ? resolve(args[dirArg + 1]) : join(root, 'content/stories');

const STATUSES = ['draft', 'review', 'published', 'preview'];
const PUBLIC_STATUSES = ['published', 'preview'];
const CONTENT_STATES = ['approved', 'sample'];
const ITEM_TYPES = ['choice', 'truefalse', 'sequence', 'shortanswer'];
const PRACTICE_TYPES = ['match', 'flashcards', 'gapfill', 'listen'];

const errors = [];
const warnings = [];

const exists = async (p) => access(p).then(() => true, () => false);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

// Language checks
const WORD_RANGES = { A: [40, 60], B: [80, 120], C: [150, 220] };
const HARAKAT = /[ً-ْٰ]/;
const bare = (t) => String(t).replace(/[ً-ٰٟـ]/g, '');
/** Arabic words in a text, without surrounding punctuation. */
const arabicWords = (text) => tokenize(text ?? '').map((t) => splitPunctuation(t).word).filter((w) => /[ء-ي]/.test(w));
const OTHER_CONNECTORS = new Set(['و', 'أو', 'لذلك', 'لهذا', 'عندما', 'بينما', 'حينما', 'إذا', 'لو', 'كي', 'لكي', 'حتى', 'بل']);
// shortcut: catches standalone connectors and وال… (و + definite noun); misses و attached to verbs, upgrade with a word list if that matters.
const isOtherConnector = (w) => OTHER_CONNECTORS.has(w) || /^وال/.test(w);
/** Every Arabic string in a story, with its JSON path. Skips typed accepted answers and interface labels (version tabs). */
function* arabicStrings(node, path = '') {
  if (typeof node === 'string') { if (/[ء-ي]/.test(node)) yield [path, node]; return; }
  if (Array.isArray(node)) { for (const [i, v] of node.entries()) yield* arabicStrings(v, `${path}[${i}]`); return; }
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (k !== 'accepted' && k !== 'label') yield* arabicStrings(v, path ? `${path}.${k}` : k);
}

async function main() {
  const config = JSON.parse(await readFile(join(root, 'content/config.json'), 'utf8'));
  const levelIds = new Set(config.levels.map((l) => l.id));
  const topicIds = new Set(config.topics.map((t) => t.id));
  const collectionIds = new Set(config.collections.map((c) => c.id));
  const courseIds = new Set((config.courses || []).map((c) => c.id));
  const modeIds = new Set(config.diacriticModes.map((m) => m.id));
  const ruleIds = new Set(Object.keys(config.answerRules));

  const files = (await readdir(storiesDir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) errors.push(`${storiesDir}: no story files found`);

  const seenIds = new Map();
  const seenSlugs = new Map();
  const stories = [];

  for (const file of files) {
    const where = `stories/${file}`;
    const err = (msg) => errors.push(`${where}: ${msg}`);
    const warn = (msg) => warnings.push(`${where}: ${msg}`);

    let s;
    try {
      s = JSON.parse(await readFile(join(storiesDir, file), 'utf8'));
    } catch (e) {
      err(`invalid JSON (${e.message})`);
      continue;
    }

    // Identity and metadata, required for every status.
    for (const key of ['id', 'slug']) if (!isNonEmptyString(s[key])) err(`missing ${key}`);
    if (s.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)) err(`slug "${s.slug}" must be lowercase words joined by hyphens`);
    if (s.slug && file !== `${s.slug}.json`) err(`file name must be "${s.slug}.json" to match the slug`);
    if (s.id) {
      if (seenIds.has(s.id)) err(`duplicate story id "${s.id}" (also in ${seenIds.get(s.id)})`);
      seenIds.set(s.id, file);
    }
    if (s.slug) {
      if (seenSlugs.has(s.slug)) err(`duplicate slug "${s.slug}" (also in ${seenSlugs.get(s.slug)})`);
      seenSlugs.set(s.slug, file);
    }
    if (!Number.isInteger(s.contentVersion) || s.contentVersion < 1) err('contentVersion must be an integer >= 1');
    if (!STATUSES.includes(s.status)) err(`status must be one of ${STATUSES.join(', ')}`);
    if (!CONTENT_STATES.includes(s.contentState)) err(`contentState must be one of ${CONTENT_STATES.join(', ')}`);
    if (!isNonEmptyString(s.title?.ar)) err('missing title.ar');
    if (!isNonEmptyString(s.description?.en) && !isNonEmptyString(s.description?.ar)) err('missing description');
    if (!levelIds.has(s.level)) err(`unknown level "${s.level}" (see content/config.json)`);
    if (!Array.isArray(s.topics)) err('topics must be an array');
    for (const t of s.topics || []) if (!topicIds.has(t)) err(`unknown topic "${t}"`);
    for (const c of s.collections || []) if (!collectionIds.has(c)) err(`unknown collection "${c}"`);
    if (s.course != null && !courseIds.has(s.course)) err(`unknown course "${s.course}"`);
    if (!s.cover || !isNonEmptyString(s.cover.alt)) err('cover.alt is required (describe the illustration, or say it is pending)');
    if (s.cover?.src && !(await exists(join(root, s.cover.src)))) err(`missing asset ${s.cover.src}`);

    stories.push(s);
    if (s.status === 'preview') continue; // Preview cards need metadata only.

    if (!Number.isFinite(s.readingMinutes) || s.readingMinutes <= 0) err('readingMinutes must be a positive number');
    if (s.status === 'published' && s.contentState === 'sample') warn('published with contentState "sample": the page shows a sample-content banner');

    // Text variants
    const variants = s.textVariants;
    if (!Array.isArray(variants) || variants.length === 0) err('textVariants must list at least one diacritic mode');
    for (const v of variants || []) if (!modeIds.has(v)) err(`unknown text variant "${v}" (see diacriticModes in config)`);
    if (!variants?.includes(s.defaultVariant)) err('defaultVariant must be one of textVariants');

    // Readings, paragraphs, sentences
    const sentenceTokens = new Map(); // sentence id -> token count
    const sentenceHasAudio = new Set();
    const ids = new Set();
    const uniq = (id, kind) => {
      if (!isNonEmptyString(id)) return err(`${kind} without an id`);
      if (ids.has(id)) err(`duplicate id "${id}"`);
      ids.add(id);
    };
    const level = config.levels.find((l) => l.id === s.level);
    if (!Array.isArray(s.readings) || s.readings.length === 0) err('at least one reading is required');
    for (const r of s.readings || []) {
      uniq(r.id, 'reading');
      if (!isNonEmptyString(r.label)) err(`reading ${r.id}: missing label`);
      if (r.audio?.src && !(await exists(join(root, r.audio.src)))) err(`reading ${r.id}: missing asset ${r.audio.src}`);
      let lastEnd = -1;
      for (const p of r.paragraphs || []) {
        uniq(p.id, 'paragraph');
        if (!p.sentences?.length) err(`paragraph ${p.id}: no sentences`);
        for (const sn of p.sentences || []) {
          uniq(sn.id, 'sentence');
          const counts = [];
          for (const v of variants || []) {
            const text = sn.text?.[v];
            if (!isNonEmptyString(text)) err(`sentence ${sn.id}: missing "${v}" text`);
            else counts.push([v, tokenize(text).length]);
          }
          // Variants must align token-for-token so vocabulary anchors resolve in every mode.
          if (new Set(counts.map(([, n]) => n)).size > 1) {
            err(`sentence ${sn.id}: variants have different token counts (${counts.map(([v, n]) => `${v}=${n}`).join(', ')})`);
          }
          sentenceTokens.set(sn.id, counts[0]?.[1] ?? 0);
          if (sn.audio?.src || (sn.timing?.verified && r.audio?.src)) sentenceHasAudio.add(sn.id);
          if (level?.translations && !isNonEmptyString(sn.translation)) err(`sentence ${sn.id}: missing translation (translations are enabled for ${s.level})`);
          if (sn.audio?.src && !(await exists(join(root, sn.audio.src)))) err(`sentence ${sn.id}: missing asset ${sn.audio.src}`);
          if (sn.timing != null) {
            const { start, end } = sn.timing;
            if (!r.audio?.src) err(`sentence ${sn.id}: timing given but reading ${r.id} has no audio`);
            if (!(Number.isFinite(start) && Number.isFinite(end) && start < end)) err(`sentence ${sn.id}: timing needs numeric start < end`);
            else if (start < lastEnd) err(`sentence ${sn.id}: timing overlaps the previous sentence`);
            else lastEnd = end;
            if (sn.timing.verified !== true) err(`sentence ${sn.id}: timing must be marked "verified": true (estimated timings are not allowed)`);
          }
        }
      }
    }

    // Language rules from docs/language-guidelines.md. They block a published story;
    // a draft only gets warnings so writers can save work in progress.
    const rule = s.status === 'published' ? err : warn;
    const versionIds = (s.readings || []).map((r) => r.id);
    if (!['A', 'B', 'C'].every((v) => versionIds.includes(v))) rule('needs three versions with ids A, B and C');
    for (const r of s.readings || []) {
      const range = WORD_RANGES[r.id];
      if (!range) continue;
      const words = (r.paragraphs || []).flatMap((p) => p.sentences || []).reduce((n, sn) => n + arabicWords(sn.text?.full).length, 0);
      if (words < range[0] || words > range[1]) rule(`version ${r.id} has ${words} words; the guideline is ${range[0]}–${range[1]}`);
      for (const sn of (r.paragraphs || []).flatMap((p) => p.sentences || [])) {
        // Heuristic, so always a warning: a listed word may be a preposition in context.
        const found = arabicWords(sn.text?.full).filter((w) => isOtherConnector(bare(w)));
        if (found.length) warn(`sentence ${sn.id}: possible connector outside لكن، لأن، الآن، جدًا، ثم: ${found.join('، ')}`);
      }
    }
    for (const [path, text] of arabicStrings(s)) {
      if (/(^|\s)ما\s+عند/.test(bare(text))) rule(`${path}: uses ما عند…; the guidelines use ليس عند…`);
      const unvowelled = arabicWords(text).filter((w) => bare(w).length > 1 && !HARAKAT.test(w));
      if (unvowelled.length) rule(`${path}: not fully vowelled (${unvowelled.slice(0, 3).join('، ')})`);
    }

    // Vocabulary
    const vocabIds = new Set();
    const vocabHasAudio = new Set();
    const covered = new Map(); // sentence id -> Set of anchored token indices
    for (const v of s.vocabulary || []) {
      uniq(v.id, 'vocabulary entry');
      vocabIds.add(v.id);
      if (v.audio?.src) vocabHasAudio.add(v.id);
      for (const mode of variants || []) if (!isNonEmptyString(v.headword?.[mode])) err(`vocabulary ${v.id}: missing headword for "${mode}"`);
      if (!isNonEmptyString(v.gloss)) err(`vocabulary ${v.id}: missing gloss`);
      if (v.image?.src && !(await exists(join(root, v.image.src)))) err(`vocabulary ${v.id}: missing asset ${v.image.src}`);
      if (v.audio?.src && !(await exists(join(root, v.audio.src)))) err(`vocabulary ${v.id}: missing asset ${v.audio.src}`);
      if (!v.anchors?.length) warn(`vocabulary ${v.id}: no anchors, so it only appears in the review list`);
      for (const a of v.anchors || []) {
        if (!sentenceTokens.has(a.sentence)) { err(`vocabulary ${v.id}: unknown sentence "${a.sentence}"`); continue; }
        const [start, end] = a.tokens || [];
        const n = sentenceTokens.get(a.sentence);
        if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= n)) {
          err(`vocabulary ${v.id}: token range ${JSON.stringify(a.tokens)} is outside sentence ${a.sentence} (${n} tokens)`);
          continue;
        }
        const set = covered.get(a.sentence) || new Set();
        for (let i = start; i < end; i++) {
          if (set.has(i)) err(`vocabulary ${v.id}: overlaps another anchor in ${a.sentence} at token ${i}`);
          set.add(i);
        }
        covered.set(a.sentence, set);
      }
    }

    // Activities
    const checkEvidence = (owner, evidence) => {
      if (!Array.isArray(evidence) || evidence.length === 0) err(`${owner}: needs at least one evidence sentence`);
      for (const e of evidence || []) if (!sentenceTokens.has(e)) err(`${owner}: unknown evidence sentence "${e}"`);
    };
    const comp = s.activities?.comprehension;
    if (!comp) err('missing activities.comprehension');
    else {
      uniq(comp.id, 'activity');
      if (!Number.isInteger(comp.version)) err(`activity ${comp.id}: version must be an integer`);
      for (const it of comp.items || []) {
        const owner = `question ${it.id}`;
        uniq(it.id, 'question');
        if (!ITEM_TYPES.includes(it.type)) { err(`${owner}: unknown type "${it.type}"`); continue; }
        if (!isNonEmptyString(it.explanation)) err(`${owner}: missing explanation (feedback must explain the answer)`);
        checkEvidence(owner, it.evidence);
        if (it.type === 'choice') {
          if (!(it.options?.length >= 2)) err(`${owner}: needs at least 2 options`);
          if (!it.options?.some((o) => o.id === it.answer)) err(`${owner}: answer "${it.answer}" is not one of the option ids`);
        }
        if (it.type === 'truefalse') {
          if (typeof it.answer !== 'boolean') err(`${owner}: answer must be true or false`);
          if (it.answer === false && !isNonEmptyString(it.correction)) err(`${owner}: false statements need a correction`);
        }
        if (it.type === 'sequence' && !(it.steps?.length >= 2)) err(`${owner}: needs at least 2 steps`);
        if (it.type === 'shortanswer') {
          if (!it.accepted?.length) err(`${owner}: missing accepted answers`);
          if (!ruleIds.has(it.rules)) err(`${owner}: unknown answer rule set "${it.rules}"`);
        }
      }
      if (!comp.items?.length) err('comprehension has no questions');
    }
    for (const act of s.activities?.practice || []) {
      uniq(act.id, 'activity');
      if (!PRACTICE_TYPES.includes(act.type)) err(`activity ${act.id}: unknown type "${act.type}"`);
      if (!Number.isInteger(act.version)) err(`activity ${act.id}: version must be an integer`);
      if (act.type === 'match') {
        if (!(act.pairs?.length >= 2)) err(`activity ${act.id}: needs at least 2 pairs`);
        for (const p of act.pairs || []) if (!vocabIds.has(p.vocab)) err(`activity ${act.id}: unknown vocabulary "${p.vocab}"`);
      }
      if (act.type === 'flashcards') {
        if (!(act.cards?.length >= 2)) err(`activity ${act.id}: needs at least 2 cards`);
        for (const c of act.cards || []) if (!vocabIds.has(c.vocab)) err(`activity ${act.id}: unknown vocabulary "${c.vocab}"`);
      }
      if (act.type === 'gapfill') {
        if (!(act.items?.length >= 2)) err(`activity ${act.id}: needs at least 2 gaps`);
        const itemIds = new Set();
        for (const it of act.items || []) {
          if (itemIds.has(it.id)) err(`activity ${act.id}: duplicate item id "${it.id}"`);
          itemIds.add(it.id);
          if (!sentenceTokens.has(it.sentence)) { err(`activity ${act.id}: unknown sentence "${it.sentence}"`); continue; }
          const [a, b] = it.gap || [];
          const n = sentenceTokens.get(it.sentence);
          if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b > a && b <= n)) err(`activity ${act.id}: gap ${JSON.stringify(it.gap)} is outside sentence ${it.sentence} (${n} tokens)`);
        }
        for (const d of act.distractors || []) if (!vocabIds.has(d)) err(`activity ${act.id}: unknown distractor vocabulary "${d}"`);
      }
      if (act.type === 'listen') {
        if (!act.items?.length) err(`activity ${act.id}: needs at least 1 item`);
        const refOk = (ref, where) => {
          const kinds = ['sentence', 'vocab', 'image'].filter((k) => ref?.[k] != null);
          if (kinds.length !== 1) { err(`${where}: give exactly one of sentence, vocab or image`); return false; }
          if (ref.sentence && !sentenceTokens.has(ref.sentence)) { err(`${where}: unknown sentence "${ref.sentence}"`); return false; }
          if (ref.vocab && !vocabIds.has(ref.vocab)) { err(`${where}: unknown vocabulary "${ref.vocab}"`); return false; }
          return true;
        };
        const itemIds = new Set();
        let silent = 0;
        for (const it of act.items || []) {
          const where = `activity ${act.id} item ${it.id}`;
          if (itemIds.has(it.id)) err(`activity ${act.id}: duplicate item id "${it.id}"`);
          itemIds.add(it.id);
          if (it.play?.image) err(`${where}: "play" must be a sentence or vocabulary entry`);
          else if (refOk(it.play, `${where} play`)) {
            const audible = it.play.sentence ? sentenceHasAudio.has(it.play.sentence) : vocabHasAudio.has(it.play.vocab);
            if (!audible) silent++;
          }
          if (!(it.options?.length >= 2)) err(`${where}: needs at least 2 options`);
          const optIds = new Set();
          for (const o of it.options || []) {
            if (optIds.has(o.id)) err(`${where}: duplicate option id "${o.id}"`);
            optIds.add(o.id);
            refOk(o, `${where} option ${o.id}`);
            if (o.image) {
              if (!isNonEmptyString(o.image.alt)) err(`${where} option ${o.id}: picture needs alt text`);
              if (!o.image.src) err(`${where} option ${o.id}: picture options need an illustration file (placeholders cannot be told apart)`);
              else if (!(await exists(join(root, o.image.src)))) err(`${where} option ${o.id}: missing asset ${o.image.src}`);
            }
          }
          if (!optIds.has(it.answer)) err(`${where}: answer "${it.answer}" is not one of the option ids`);
        }
        if (silent) warn(`activity ${act.id}: ${silent} of ${act.items?.length} item(s) have no audio yet and are hidden on the page`);
      }
    }

    // Production
    const pr = s.production;
    if (pr) {
      uniq(pr.id, 'production');
      if (!Number.isInteger(pr.version)) err(`production ${pr.id}: version must be an integer`);
      if (!isNonEmptyString(pr.instructions)) err(`production ${pr.id}: missing instructions`);
      for (const pic of pr.pictures || []) {
        if (!isNonEmptyString(pic.alt)) err(`production ${pr.id}: every picture needs alt text`);
        if (pic.src && !(await exists(join(root, pic.src)))) err(`production ${pr.id}: missing asset ${pic.src}`);
      }
    } else warn('no production (retelling/writing) task');

    for (const t of s.teacherNotes?.circling || []) if (!sentenceTokens.has(t.sentence)) err(`teacherNotes: unknown sentence "${t.sentence}"`);
  }

  // Cross-story references
  for (const s of stories) {
    for (const slug of s.related || []) if (!seenSlugs.has(slug)) errors.push(`stories/${s.slug}.json: related story "${slug}" does not exist`);
  }

  for (const w of warnings) console.warn(`warning  ${w}`);
  for (const e of errors) console.error(`error    ${e}`);

  if (errors.length) {
    console.error(`\n${errors.length} error(s). Index not written.`);
    process.exit(1);
  }

  const publicStories = stories.filter((s) => PUBLIC_STATUSES.includes(s.status));
  const index = {
    generatedBy: 'scripts/validate.mjs',
    stories: publicStories.map((s) => ({
      id: s.id,
      slug: s.slug,
      status: s.status,
      contentState: s.contentState,
      contentVersion: s.contentVersion,
      featured: Boolean(s.featured),
      title: s.title,
      description: s.description,
      level: s.level,
      topics: s.topics || [],
      collections: s.collections || [],
      course: s.course ?? null,
      unit: s.unit ?? null,
      readingMinutes: s.readingMinutes ?? null,
      cover: s.cover,
      focus: (s.vocabulary || []).slice(0, 3).map((x) => x.headword?.full).filter(Boolean),
    })),
  };
  if (!checkOnly && dirArg < 0) {
    await writeFile(join(root, 'content/index.json'), JSON.stringify(index, null, 2) + '\n');
  }
  const hidden = stories.length - publicStories.length;
  console.log(`OK: ${stories.length} story file(s) valid; ${publicStories.length} public, ${hidden} hidden (draft/review).${checkOnly || dirArg >= 0 ? '' : ' Wrote content/index.json.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
