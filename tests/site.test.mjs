// Browser tests: devices, touch, keyboard, reduced motion, the pause control, accessibility, page weight.
// Run with: npm run test:site   (needs Chromium: npx playwright install chromium)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

let server, browser, BASE, axeSource;
const SHOTS = new URL('../test-results/', import.meta.url);

before(async () => {
  server = await serve();
  BASE = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  axeSource = await readFile(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
  await mkdir(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); });

const DEVICES = {
  'iPhone SE': { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'iPhone 15': { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'Pixel 7': { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
  'Phone landscape': { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'iPad mini': { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'iPad Pro landscape': { viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'Laptop 1280': { viewport: { width: 1280, height: 720 } },
  'Desktop 1440': { viewport: { width: 1440, height: 900 } },
  'Desktop 1920': { viewport: { width: 1920, height: 1080 } },
  'Ultrawide 2560': { viewport: { width: 2560, height: 1080 } }
};
const PAGES = ['home', 'research', 'notes', 'about'];

// Open the site. intro: true plays it as a first-time visitor would; otherwise it is marked as seen.
async function open(device = 'Desktop 1440', { intro = false, theme = 'dark', reducedMotion = 'no-preference', hash = '', storage = {}, js = true } = {}) {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: theme, reducedMotion, javaScriptEnabled: js });
  await ctx.addInitScript(([seen, extra]) => {
    try {
      if (seen) sessionStorage.setItem('hn-intro-seen', '1');
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    } catch (e) { /* ignore */ }
  }, [!intro, storage]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + hash);
  return { ctx, page, errors };
}
const revealed = page => page.waitForFunction(() => !document.documentElement.classList.contains('intro-on'), null, { timeout: 12000 });
// Compare with the device's real width: on phones the browser widens its layout viewport to fit overflowing content.
const noSideScroll = (page, width) => page.evaluate(w => Math.max(document.documentElement.scrollWidth, innerWidth) - w, width);
const rect = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; });
// A cheap fingerprint of what a canvas currently shows.
const canvasSig = (page, sel) => page.$eval(sel, c => {
  const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h;
});

test('every device: the intro, then a readable hero with no sideways scrolling or errors', async () => {
  for (const name of Object.keys(DEVICES)) {
    const { ctx, page, errors } = await open(name, { intro: true });
    await page.waitForTimeout(1200);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('intro-on')), `${name}: intro should be playing`);
    if (DEVICES[name].hasTouch) await page.tap('#skip'); else await page.click('#skip');
    await revealed(page);
    await page.waitForTimeout(2300);   // the glide to the resting position
    await page.screenshot({ path: new URL(`home-${name.replace(/\s+/g, '-')}.png`, SHOTS).pathname });

    const vw = DEVICES[name].viewport.width;
    const h1 = await rect(page, '#h-home'), lede = await rect(page, '#hero-lede'), cta = await rect(page, '.btn-primary');
    const hole = await page.evaluate(() => window.__site.hole);
    assert.ok(h1.x >= 0 && h1.right <= vw + 1, `${name}: headline runs off screen (${h1.x}–${h1.right})`);
    assert.ok(cta.w > 0 && cta.right <= vw + 1, `${name}: the research button is cut off`);
    if (vw >= 700) assert.ok(hole.x > lede.right, `${name}: the black hole (x=${hole.x.toFixed(0)}) should sit right of the paragraph (ends ${lede.right.toFixed(0)})`);
    else assert.ok(hole.y + hole.r < h1.y, `${name}: the black hole should sit above the headline`);
    for (const p of PAGES) {
      await page.evaluate(id => { location.hash = id; }, p);
      await page.waitForTimeout(150);
      assert.equal(await noSideScroll(page, vw), 0, `${name}: page "${p}" is wider than the screen`);
    }
    assert.deepEqual(errors, [], `${name}: errors in the console`);
    await ctx.close();
  }
});

test('the intro reveals the page after about six seconds and plays once per session', async () => {
  const { ctx, page } = await open('iPhone 15', { intro: true });
  const t0 = Date.now();
  await revealed(page);
  const s = (Date.now() - t0) / 1000;
  assert.ok(s > 5 && s < 10, `revealed after ${s.toFixed(1)} s`);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('intro-on')), false, 'intro should not replay on reload');
  await ctx.close();
});

test('touch: tap to navigate, tap the sheet to emit light, drag the sliders', async () => {
  const { ctx, page, errors } = await open('Pixel 7');
  await page.tap('a[data-nav="research"]');
  await page.waitForFunction(() => document.documentElement.dataset.page === 'research');
  assert.ok(await page.isVisible('#h-research'));
  assert.equal(await page.title(), 'Research · Hieu Nguyen');
  await page.tap('a[data-nav="notes"]');
  await page.tap('.chip[data-filter="Physics"]');
  assert.equal(await page.$$eval('#catalog .entry:not([hidden])', els => els.length), 2, 'the Physics filter should leave two entries');
  await page.tap('a[data-nav="home"]');
  await page.waitForFunction(() => document.documentElement.dataset.page === 'home');

  await page.$eval('#field', el => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1200);
  const f = await rect(page, '#field');
  await page.touchscreen.tap(f.x + f.w * 0.25, f.y + f.h * 0.7);
  await page.waitForTimeout(400);
  await page.waitForFunction(() => +document.getElementById('o-ph').textContent > 0, null, { timeout: 3000 });

  const cdp = await ctx.newCDPSession(page);
  const s = await rect(page, '#rs');
  const y = s.y + s.h / 2, x0 = s.x + s.w * ((0.6 - 0.15) / (1.2 - 0.15)), x1 = s.x + s.w * 0.95;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const rs = +(await page.inputValue('#rs'));
  assert.ok(rs > 1.0, `dragging the lens slider should raise r_s (now ${rs})`);
  assert.equal(await page.textContent('#o-bc'), (1.5 * Math.sqrt(3) * rs).toFixed(2), 'b_c readout should equal (3√3/2) r_s');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('keyboard: skip link, a sensible focus order with visible focus, and page changes move focus', async () => {
  const { ctx, page } = await open('Desktop 1440');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  await page.waitForFunction(() => document.querySelector('.skip-link').getBoundingClientRect().top >= 0, null, { timeout: 2000 })
    .catch(() => assert.fail('skip link should slide into view when focused'));

  const order = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement, cs = getComputedStyle(el);
      return { id: el.id || el.textContent.trim().slice(0, 24), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
    });
    order.push(f.id);
    assert.ok(f.outline, `focus on "${f.id}" should show an outline`);
    if (f.id === 'replay') break;
  }
  const expected = ['Hieu Nguyen', 'Home', 'Research', 'Notes', 'About', 'theme', 'Explore my research', 'A little about me', 'motion', 'rs', 'sigma', 'emit', 'run', 'replay'];
  assert.deepEqual(order, expected, 'tab order');

  // the skip link jumps past the header
  await page.evaluate(() => document.activeElement.blur());
  await page.focus('.skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Explore my research');

  await page.focus('a[data-nav="about"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'h-about');
  assert.equal(await page.title(), 'About · Hieu Nguyen');

  await page.focus('a[data-nav="home"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'h-home');   // the page change moves focus; wait for it
  await page.focus('#rs');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await page.inputValue('#rs'), '0.65');
  assert.equal(await page.textContent('#o-bc'), (1.5 * Math.sqrt(3) * 0.65).toFixed(2));
  await page.focus('#motion');
  await page.keyboard.press('Space');
  assert.equal(await page.textContent('#motion .motion-label'), 'Play animation');
  await ctx.close();
});

test('keyboard: any key skips the intro', async () => {
  const { ctx, page } = await open('Desktop 1440', { intro: true });
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await revealed(page);
  await ctx.close();
});

test('reduced motion: no intro, everything still, and the visitor can opt back in', async () => {
  const { ctx, page, errors } = await open('Desktop 1440', { intro: true, reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('intro-on')), false, 'no intro');
  assert.equal(await page.textContent('#motion .motion-label'), 'Play animation');
  assert.equal(await page.textContent('#run'), 'Resume');
  const f0 = await page.evaluate(() => window.__site.frames), sig0 = await canvasSig(page, '#cosmos');
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__site.frames), f0, 'the black hole should not animate');
  assert.equal(await canvasSig(page, '#cosmos'), sig0, 'the canvas should not change');
  assert.notEqual(sig0, 0, 'a still frame of the disk should still be drawn');
  await page.click('#motion');
  await page.waitForTimeout(800);
  assert.ok(await page.evaluate(() => window.__site.frames) > f0 + 10, 'Play should start the animation');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the pause control freezes both animations and is remembered', async () => {
  const { ctx, page } = await open('Desktop 1440');
  await page.waitForTimeout(800);
  await page.click('#motion');
  const f0 = await page.evaluate(() => window.__site.frames), sig0 = await canvasSig(page, '#cosmos');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => window.__site.frames), f0);
  assert.equal(await canvasSig(page, '#cosmos'), sig0);
  assert.equal(await page.textContent('#run'), 'Resume', 'the observatory pauses too');
  const fresh = await ctx.newPage();   // a new tab: a new session, but the same saved preference
  await fresh.goto(BASE);
  await fresh.waitForTimeout(500);
  assert.equal(await fresh.evaluate(() => document.documentElement.classList.contains('intro-on')), false, 'no intro once paused');
  assert.equal(await fresh.textContent('#motion .motion-label'), 'Play animation');
  await ctx.close();
});

test('animation stops when it cannot be seen', async () => {
  const { ctx, page } = await open('Desktop 1440');
  await page.waitForTimeout(600);
  await page.evaluate(() => { location.hash = 'research'; });
  await page.waitForTimeout(300);
  let f0 = await page.evaluate(() => window.__site.frames);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.__site.frames), f0, 'stops on other pages');
  await page.evaluate(() => { location.hash = 'home'; });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  f0 = await page.evaluate(() => window.__site.frames);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.__site.frames), f0, 'stops once scrolled past the hero');
  await ctx.close();
});

test('accessibility: no serious or critical axe violations, in either theme', async () => {
  for (const theme of ['dark', 'light']) {
    const { ctx, page } = await open('Desktop 1440', { theme });
    for (const p of PAGES) {
      await page.evaluate(id => { location.hash = id; }, p);
      await page.waitForTimeout(250);
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
      const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      assert.deepEqual(bad.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`), [], `${theme} / ${p}`);
    }
    await ctx.close();
  }
});

test('light theme: the hero stays dark and legible, the rest of the page turns light', async () => {
  const { ctx, page } = await open('Desktop 1440', { theme: 'light' });
  const brand = await page.$eval('.brand', el => getComputedStyle(el).color);
  assert.equal(brand, 'rgb(236, 232, 222)', 'header text over the hero stays light');
  const obsBg = await page.$eval('.after', el => getComputedStyle(el).backgroundColor);
  assert.equal(obsBg, 'rgb(238, 240, 241)', 'the observatory section is light');
  await page.evaluate(() => { location.hash = 'research'; });
  await page.waitForTimeout(200);
  assert.equal(await page.$eval('body', el => getComputedStyle(el).backgroundColor), 'rgb(238, 240, 241)');
  assert.equal(await page.$eval('.brand', el => getComputedStyle(el).color), 'rgb(20, 25, 35)');
  await ctx.close();
});

test('the browser runs the tested physics', async () => {
  const { ctx, page } = await open('Desktop 1440');
  for (const v of ['0.15', '0.6', '1.2']) {
    await page.$eval('#rs', (el, val) => { el.value = val; el.dispatchEvent(new Event('input')); }, v);
    const expected = await page.evaluate(val => window.Physics.criticalImpact(+val).toFixed(2), v);
    assert.equal(await page.textContent('#o-bc'), expected);
    assert.equal(expected, (1.5 * Math.sqrt(3) * +v).toFixed(2));
  }
  await page.$eval('#field', el => el.scrollIntoView({ block: 'center' }));
  await page.click('#emit');
  await page.waitForFunction(() => +document.getElementById('o-ph').textContent > 50, null, { timeout: 3000 });
  await ctx.close();
});

test('page weight: small, and nothing loaded from other sites', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const responses = [];
  page.on('response', r => responses.push(r));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  let bytes = 0;
  for (const r of responses) bytes += (await r.body().catch(() => Buffer.alloc(0))).length;
  const foreign = responses.map(r => r.url()).filter(u => !u.startsWith(BASE));
  assert.deepEqual(foreign, [], 'third-party requests');
  assert.ok(bytes < 350 * 1024, `page weighs ${(bytes / 1024).toFixed(0)} KB`);
  console.log(`  page weight: ${(bytes / 1024).toFixed(0)} KB in ${responses.length} requests (uncompressed)`);
  await ctx.close();
});

test('without JavaScript every page is still readable', async () => {
  const { ctx, page } = await open('Desktop 1440', { js: false });
  for (const id of ['h-home', 'h-research', 'h-notes', 'h-about']) assert.ok(await page.isVisible('#' + id), `${id} visible`);
  await ctx.close();
});

test('notes: each description sits under its title, and each title opens its own page', async () => {
  const { ctx, page, errors } = await open('Desktop 1440', { hash: '#notes' });
  const entries = await page.$$eval('#catalog .entry', els => els.map(el => {
    const h = el.querySelector('h2').getBoundingClientRect(), d = el.querySelector('p:not(.meta)').getBoundingClientRect();
    return { title: el.querySelector('h2').textContent.trim(), href: el.querySelector('h2 a').getAttribute('href'), below: d.top >= h.bottom - 1, left: Math.abs(d.left - h.left) < 2 };
  }));
  assert.equal(entries.length, 7);
  for (const e of entries) {
    assert.ok(e.below && e.left, `${e.title}: the description should start under the title`);
    const res = await page.goto(BASE + e.href);
    assert.equal(res.status(), 200, `${e.href} should exist: create ${e.href}index.html from scripts/note-template.html (see README, "Adding a note")`);
    assert.equal(await page.textContent('h1'), e.title, `${e.href}: the page's heading should match its title in the Notes list`);
    for (const s of ['Lecture notes', 'Problem sets']) assert.ok(await page.isVisible(`.course-section h2:text("${s}")`), `${e.href}: "${s}" section`);
    assert.equal(await page.getAttribute('.crumb', 'href'), '/#notes');
    for (const a of await page.$$eval('.doc-link[href]', els => els.map(x => x.getAttribute('href')))) {
      const r = await page.request.get(new URL(a, page.url()).href);
      assert.equal(r.status(), 200, `${e.href}: linked file ${a} is missing`);
    }
  }
  await page.goto(BASE + entries[0].href);
  await page.click('.crumb');
  await page.waitForFunction(() => document.documentElement.dataset.page === 'notes');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('notes pages: phone layout, theme switch and accessibility', async () => {
  for (const theme of ['dark', 'light']) {
    const { ctx, page, errors } = await open('iPhone SE', { theme, hash: 'notes/mathematical-statistics/' });
    assert.equal(await noSideScroll(page, 375), 0, 'no sideways scrolling');
    const num = await rect(page, '.doc-num'), body = await rect(page, '.doc-body');
    assert.ok(body.w > 200, 'chapter text should have room on a phone');
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
    const bad = res.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    assert.deepEqual(bad.map(v => v.id), [], theme);
    const before = await page.getAttribute('html', 'data-theme');
    await page.tap('#theme');
    assert.notEqual(await page.getAttribute('html', 'data-theme'), before, 'the theme button works on notes pages');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('every link on the site leads somewhere that exists', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  const notes = await page.$$eval('#catalog h2 a', as => as.map(a => a.href));
  const PAGE_IDS = ['home', 'research', 'notes', 'about', 'main'];
  const broken = [];
  for (const url of [BASE, ...notes]) {
    await page.goto(url);
    for (const { raw, abs } of await page.$$eval('a[href]', as => as.map(a => ({ raw: a.getAttribute('href'), abs: a.href })))) {
      if (/^(mailto|tel):/.test(raw)) continue;
      const u = new URL(abs);
      if (u.origin !== new URL(BASE).origin) continue;   // links to other websites aren't checked
      if (u.pathname === '/' && u.hash) {
        if (!PAGE_IDS.includes(u.hash.slice(1))) broken.push(`${url}: "${raw}" is not one of the site's pages`);
        continue;
      }
      const r = await page.request.get(u.origin + u.pathname);
      if (r.status() !== 200) broken.push(`${url}: "${raw}" returns ${r.status()}`);
    }
  }
  assert.deepEqual(broken, [], 'broken links (for a page on the home page, use "#research", "#notes" and so on)');
  await ctx.close();
});

test('unknown addresses get the 404 page', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(BASE + 'no-such-page');
  assert.equal(res.status(), 404);
  assert.ok(await page.isVisible('text=Back to the front page'));
  await ctx.close();
});

test('slow devices: the disk sheds particles to keep frames short', async () => {
  const { ctx, page } = await open('Pixel 7');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const n0 = await page.evaluate(() => window.__site.particles);
  const f0 = await page.evaluate(() => window.__site.frames);
  await page.waitForTimeout(5000);
  const n1 = await page.evaluate(() => window.__site.particles), fps = (await page.evaluate(() => window.__site.frames) - f0) / 5;
  console.log(`  6× CPU throttle: ${n0} → ${n1} particles, ${fps.toFixed(0)} frames/s`);
  assert.ok(n1 < n0, 'particle count should drop under heavy throttling');
  await ctx.close();
});
