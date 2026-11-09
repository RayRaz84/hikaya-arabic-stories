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
const SAMPLE = `${BASE}?preview=where-is-the-phone`;
const shots = join(root, 'tests/screenshots');
const storyFile = join(root, 'dist/content/stories/where-is-the-phone.json');
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
const story = JSON.parse(await readFile(storyFile, 'utf8'));
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
    assert(text.includes('معاينة') && text.includes('محتوى تجريبي'), 'notices missing');
    await p.screenshot({ path: join(shots, 'reader-1280.png') });
    await p.goto(`${BASE}#preview-where-is-the-phone`); await p.reload();
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
    assert((await word.textContent()) === 'الْهَاتِفَ', 'punctuation must stay outside the anchor');
    await word.focus(); await p.keyboard.press('Enter');
    assert((await p.locator('.vocab-pop').textContent()).includes('the phone'), 'gloss missing');
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
    await q(4).locator('.q-input').fill('الحقيبه');
    await q(4).locator('[data-check]').click();
    assert(await q(4).locator('.feedback-box.no').count() === 1, 'ة/ه must not be merged by default');
    await q(4).locator('.q-input').fill('فِي الْحَقِيبَةِ.');
    await q(4).locator('.q-input').press('Enter');
    assert(await q(4).locator('.feedback-box.ok').count() === 1, 'vowelled answer should match');
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
} finally {
  await browser.close();
  server.kill();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
