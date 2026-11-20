#!/usr/bin/env node
// Browser checks for the library and reader. Usage: node tests/e2e.mjs
// Starts its own static server for dist/ on port 8097; screenshots go to tests/screenshots/.

import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }

const BASE = 'http://127.0.0.1:8097/';
const SAMPLE = `${BASE}?preview=khalid-and-the-ball`;
const shots = join(root, 'tests/screenshots');
const storyFile = join(root, 'dist/content/stories/khalid-and-the-ball.json');
const validate = () => spawnSync(process.execPath, [join(root, 'scripts/validate.mjs')], { encoding: 'utf8' });

let passed = 0; const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok    ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const server = spawn('python3', ['-m', 'http.server', '8097', '--bind', '127.0.0.1', '--directory', join(root, 'dist')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
await mkdir(shots, { recursive: true });
const browser = await chromium.launch();
const original = await readFile(storyFile, 'utf8');
// Tests run against a draft copy of the story and put the real file back at the end.
const story = { ...JSON.parse(original), status: 'draft', contentState: 'sample' };
await writeFile(storyFile, JSON.stringify(story, null, 2) + '\n'); validate();
const page = async (width = 1280) => {
  const p = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  return p;
};
const openSample = async (p) => { await p.goto(SAMPLE); await p.waitForSelector('#reader[open] .sentence'); };

try {
  await test('empty library shows a clear message, no stray text, no sideways scroll (390 and 1280 px)', async () => {
    for (const w of [390, 1280]) {
      const p = await page(w);
      await p.goto(BASE); await p.waitForSelector('.empty-library');
      assert(await p.locator('.story-card').count() === 0, 'drafts must not appear in the library');
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(over <= 0, `scrolls sideways by ${over}px at ${w}`);
      const stray = await p.evaluate(() => document.body.innerText.match(/\b(null|undefined|NaN)\b/g) || []);
      assert(!stray.length, `stray text: ${stray[0]}`);
      await p.screenshot({ path: join(shots, `home-${w}.png`), fullPage: true });
      assert(!p.errors.length, p.errors.join(' | '));
      await p.context().close();
    }
  });

  await test('preview link opens the draft with preview and sample notices', async () => {
    const p = await page();
    await openSample(p);
    const text = await p.locator('#reader-content').textContent();
    assert(text.includes('معاينة') && text.includes('مسودّة'), 'notices missing');
    await p.screenshot({ path: join(shots, 'reader-1280.png') });
    await p.goto(`${BASE}#preview-khalid-and-the-ball`); await p.reload();
    await p.waitForSelector('#reader[open] .sentence');
    await p.context().close();
  });

  await test('version tabs switch the text (click and arrow keys)', async () => {
    const p = await page();
    await openSample(p);
    await p.locator('[data-reading="1"]').click();
    assert(await p.locator('#s-b-s2').count() === 1, 'version B not shown');
    await p.locator('[data-reading="1"]').press('ArrowRight');
    assert(await p.locator('#s-a-s1').count() === 1, 'arrow key did not move back to A');
    await p.context().close();
  });

  await test('text size: larger and smaller, stops at the limits, remembered after refresh', async () => {
    const p = await page(390);
    await openSample(p);
    const size = () => p.locator('#story-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const start = await size();
    assert((await p.locator('#size-out').textContent()) === '١٠٠٪', 'should start at 100%');
    await p.locator('[data-size="1"]').click();
    await p.locator('[data-size="1"]').click();
    const bigger = await size();
    assert(bigger > start, 'text did not grow');
    for (let i = 0; i < 4; i++) if (await p.locator('[data-size="1"]').isEnabled()) await p.locator('[data-size="1"]').click();
    assert(await p.locator('[data-size="1"]').isDisabled(), 'larger button should stop at the maximum');
    await p.reload(); await p.waitForSelector('#reader[open] .sentence');
    assert((await p.locator('#size-out').textContent()) === '١٥٠٪', 'size not remembered after refresh');
    for (let i = 0; i < 6; i++) if (await p.locator('[data-size="-1"]').isEnabled()) await p.locator('[data-size="-1"]').click();
    assert(await p.locator('[data-size="-1"]').isDisabled() && (await size()) < start, 'smaller button should go below 100% and stop');
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 0, 'large text must not cause sideways scrolling');
    await p.context().close();
  });

  await test('translation: off by default, one sentence, all, then off', async () => {
    const p = await page(390);
    await openSample(p);
    assert(await p.locator('.sent-tr').count() === 0 && await p.locator('.sent-btn').count() === 0, 'translation visible at start');
    await p.locator('[data-tr="pick"]').click();
    const n = await p.locator('#story-text .sentence').count();
    assert(await p.locator('.sent-btn').count() === n, 'one EN button per sentence expected');
    await p.locator('.sent-btn').first().click();
    const tr = p.locator('.sent-tr').first();
    assert((await tr.textContent()) === story.readings[0].paragraphs[0].sentences[0].translation, 'wrong translation');
    assert(await tr.getAttribute('dir') === 'ltr', 'translation must be LTR');
    await p.locator('[data-tr="all"]').click();
    assert(await p.locator('.sent-tr').count() === n, 'show all failed');
    await p.screenshot({ path: join(shots, 'reader-translations-390.png') });
    await p.locator('[data-tr="off"]').click();
    assert(await p.locator('.sent-tr').count() === 0, 'off failed');
    await p.context().close();
  });

  await test('every vocabulary anchor renders; popover opens by keyboard, Escape closes it before the story', async () => {
    const p = await page();
    await openSample(p);
    for (const [ri, r] of story.readings.entries()) {
      const ids = new Set(r.paragraphs.flatMap((x) => x.sentences.map((s) => s.id)));
      const expected = story.vocabulary.flatMap((v) => v.anchors.filter((a) => ids.has(a.sentence))).length;
      await p.locator(`[data-reading="${ri}"]`).click();
      assert(await p.locator('#story-text .vocab').count() === expected, `${r.id}: anchors rendered ≠ content`);
    }
    await p.locator('[data-reading="0"]').click();
    const word = p.locator('#story-text .vocab').first();
    assert((await word.textContent()) === 'يُرِيدُ', 'first anchored word should be يُرِيدُ');
    await word.focus(); await p.keyboard.press('Enter');
    assert((await p.locator('.vocab-pop').textContent()).includes('wants'), 'gloss missing');
    const ball = p.locator('#s-a-s1 .vocab').nth(1);
    assert((await ball.textContent()) === 'الْكُرَةَ', 'punctuation must stay outside the anchor');
    await p.screenshot({ path: join(shots, 'reader-popover-1280.png') });
    await p.keyboard.press('Escape');
    assert(await p.locator('.vocab-pop').count() === 0, 'Escape did not close the popover');
    assert(await p.locator('#reader[open]').count() === 1, 'Escape closed the whole story');
    assert(await word.evaluate((el) => el === document.activeElement), 'focus not returned to the word');
    await p.context().close();
  });

  await test('questions: feedback explains, links to evidence, checks typed answers by the rules', async () => {
    const p = await page(390);
    await openSample(p);
    const q = (n) => p.locator('.q').nth(n);
    const items = story.activities.comprehension.items;
    await q(0).locator(`[data-pick="${items[0].answer}"]`).click();
    await q(0).locator('[data-check]').click();
    assert(await q(0).locator('.feedback-box.ok').count() === 1, 'Q1 should be correct');
    await q(1).locator('[data-pick="true"]').click();
    await q(1).locator('[data-check]').click();
    assert((await q(1).locator('.feedback-box.no').textContent()).includes(items[1].correction), 'correction missing');
    for (let target = 0; target < items[2].steps.length; target++) {
      for (let g = 0; g < 5; g++) {
        const texts = await q(2).locator('.seq li > span:first-child').allTextContents();
        const at = texts.indexOf(items[2].steps[target].text);
        if (at === target) break;
        await q(2).locator('.seq li').nth(at).locator('[data-dir="-1"]').click();
      }
    }
    await q(2).locator('[data-check]').click();
    assert(await q(2).locator('.feedback-box.ok').count() === 1, 'sequence should be correct');
    await q(3).locator(`[data-pick="${items[3].answer}"]`).click();
    await q(3).locator('[data-check]').click();
    await q(4).locator('.q-input').fill('ليلى');
    await q(4).locator('[data-check]').click();
    assert(await q(4).locator('.feedback-box.no').count() === 1, 'wrong answer accepted');
    await q(4).locator('.q-input').fill('القط.');
    await q(4).locator('.q-input').press('Enter');
    assert(await q(4).locator('.feedback-box.ok').count() === 1, 'unvowelled answer with punctuation should match the vowelled accepted answer');
    assert((await p.locator('.quiz .score').textContent()).includes('٤ من ٥'), 'score wrong');
    await q(0).locator('[data-evidence]').click();
    assert(await p.evaluate(() => document.activeElement?.id === 's-a-s1'), 'evidence link did not focus the sentence');
    await p.screenshot({ path: join(shots, 'reader-quiz-390.png'), fullPage: false });
    assert(!p.errors.length, p.errors.join(' | '));
    await p.context().close();
  });

  await test('a published story appears in the library, opens, and "read" persists after refresh', async () => {
    const pub = { ...story, status: 'published' };
    await writeFile(storyFile, JSON.stringify(pub, null, 2));
    try {
      assert(validate().status === 0, 'validator failed');
      const p = await page(390);
      await p.goto(BASE); await p.waitForSelector('.story-card');
      assert(await p.locator('.story-card').count() === 1, 'published story missing');
      assert((await p.locator('.word-list button').count()) > 0, 'word section not built from the story');
      await p.screenshot({ path: join(shots, 'home-published-390.png'), fullPage: true });
      await p.locator('.story-card button').click();
      await p.waitForSelector('#reader[open] .sentence');
      assert(!(await p.locator('#reader-content').textContent()).includes('معاينة'), 'published story must not show the preview notice');
      await p.locator('#complete').click();
      await p.reload(); await p.waitForSelector('.story-card');
      assert((await p.locator('.card-bottom').textContent()).includes('قرأتها'), 'read status not kept');
      await p.context().close();
    } finally {
      await writeFile(storyFile, JSON.stringify(story, null, 2) + '\n');
      validate();
    }
  });
  await test('flashcards: flip, practice marks, summary and review of missed cards', async () => {
    const p = await page(390);
    await openSample(p);
    const cards = p.locator('#cards');
    assert((await cards.locator('.fc-word').textContent()) === story.vocabulary[0].headword.full, 'first card wrong');
    assert(await cards.locator('.fc-gloss').count() === 0, 'meaning should start hidden');
    await cards.locator('[data-fc="flip"]').click();
    assert((await cards.locator('.fc-gloss').textContent()) === story.vocabulary[0].gloss, 'flip did not show the meaning');
    await p.locator('#cards [data-fc="practice"]').click();
    for (let i = 0; i < story.vocabulary.length; i++) {
      await p.locator('#cards [data-fc="flip"]').click();
      await p.locator(`#cards [data-fc="${i < 2 ? 'miss' : 'know'}"]`).click();
    }
    const done = await p.locator('#cards .fc-done').textContent();
    assert(done.includes('مراجعة') || done.includes('راجع'), 'review button missing');
    await p.locator('#cards [data-fc="review"]').click();
    assert((await p.locator('#cards .fc-count').textContent()).includes('من ٢'), 'review deck should hold the 2 missed cards');
    assert(!(await p.locator('#cards').textContent()).toLowerCase().includes('spaced'), 'must not claim spaced repetition');
    await p.screenshot({ path: join(shots, 'reader-cards-390.png') });
    await p.context().close();
  });

  await test('speaking step moves sentence by sentence and explains audio availability', async () => {
    const p = await page();
    await openSample(p);
    const s = p.locator('#speak');
    assert((await s.locator('.speak-line').textContent()) === story.readings[0].paragraphs[0].sentences[0].text.full, 'first sentence wrong');
    await s.locator('[data-speak="next"]').click();
    assert((await p.locator('#speak .speak-line').textContent()) === story.readings[0].paragraphs[0].sentences[1].text.full, 'next did not advance');
    await p.locator('#speak [data-speak="play"]').click();
    assert((await p.locator('#speak-status').textContent()).trim().length > 0, 'no audio status shown');
    await p.context().close();
  });

  await test('writing: word bank inserts, draft is private and survives a refresh', async () => {
    const p = await page();
    await openSample(p);
    await p.locator('#writing .chips button').first().click();
    await p.locator('#draft').pressSequentially('يُرِيدُ');
    await p.waitForTimeout(600);
    assert((await p.locator('#draft-status').textContent()).includes('حُفظ'), 'save status missing');
    await p.reload(); await p.waitForSelector('#reader[open] .sentence');
    assert((await p.locator('#draft').inputValue()).includes(story.production.wordBank[0]), 'draft not restored');
    await p.context().close();
  });

  await test('audio player appears only with a recording, plays and pauses, stays at the bottom', async () => {
    const p = await page(390);
    const withAudio = structuredClone(story); withAudio.readings[0].audio = { src: 'test-reading.wav' };
    const n = 12000, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40); wav.fill(128, 44);
    await p.route('**/content/stories/khalid-and-the-ball.json', (r) => r.fulfill({ json: withAudio }));
    await p.route('**/test-reading.wav', (r) => r.fulfill({ body: wav, contentType: 'audio/wav' }));
    await openSample(p);
    const play = p.locator('#pl-play');
    assert(await play.getAttribute('aria-label') === 'تشغيل', 'must not autoplay');
    await play.click();
    await p.waitForFunction(() => document.querySelector('#pl-play')?.getAttribute('aria-label') === 'إيقاف مؤقت', null, { timeout: 5000 });
    await p.locator('#pl-play').click();
    assert(await p.locator('.player').evaluate((el) => getComputedStyle(el).position) === 'sticky', 'player should stay on screen');
    await p.locator('[data-reading="1"]').click();
    assert(await p.locator('.player').count() === 0, 'version B has no recording, so no player');
    await p.context().close();
  });

  await test('story links, related stories and sharing with two published stories', async () => {
    const second = { ...story, id: 'story-9001', slug: 'second-test', status: 'published', title: { ...story.title, ar: 'حِكَايَةٌ ثَانِيَةٌ' } };
    const secondFile = join(root, 'dist/content/stories/second-test.json');
    await writeFile(storyFile, JSON.stringify({ ...story, status: 'published' }, null, 2));
    await writeFile(secondFile, JSON.stringify(second, null, 2));
    try {
      assert(validate().status === 0, 'validator failed');
      const p = await page();
      await p.goto(`${BASE}#story-second-test`);
      await p.waitForSelector('#reader[open] .sentence');
      assert((await p.locator('#reader-content h2').first().textContent()) === 'حِكَايَةٌ ثَانِيَةٌ', 'link opened the wrong story');
      assert((await p.locator('.reader-top-sub').textContent()).includes('القصص'), 'breadcrumb missing');
      await p.locator('.related-card').first().click();
      await p.waitForFunction(() => location.hash === '#story-khalid-and-the-ball');
      await p.locator('#copy-link').click();
      assert((await p.locator('#copy-status').textContent()).trim().length > 0, 'copy link gave no feedback');
      assert((await p.locator('.share a').getAttribute('href')).includes('whatsapp'), 'WhatsApp link missing');
      await p.locator('.close').click();
      await p.waitForFunction(() => location.hash === '', null, { timeout: 3000 }).catch(() => {});
      assert(await p.evaluate(() => location.hash) === '', 'closing should clear the story link');
      assert(!p.errors.length, p.errors.join(' | '));
      await p.context().close();
    } finally {
      await rm(secondFile);
      await writeFile(storyFile, JSON.stringify(story, null, 2) + '\n');
      validate();
    }
  });
} finally {
  await browser.close();
  server.kill();
  await writeFile(storyFile, original); validate();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
