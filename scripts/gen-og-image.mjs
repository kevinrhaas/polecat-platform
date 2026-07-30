#!/usr/bin/env node
// gen-og-image.mjs — renders site/assets/og-image.png (1200×630, the
// standard OG/Twitter card size) from scripts/og-image-template.html via a
// headless screenshot. Re-run whenever the house mark or brand gradient
// changes.
//
// Usage: node scripts/gen-og-image.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(join(ROOT, 'scripts/og-image-template.html'), 'utf8');
// The house mark (canonical vector, black; the template inverts it to white)
// and the brand face, all inlined as data URIs — setContent has no base URL.
const b64 = (p) => readFileSync(join(ROOT, p)).toString('base64');
const html = template
  .replaceAll('MASCOT_SRC', `data:image/svg+xml;base64,${b64('site/assets/logo-mark.svg')}`)
  .replaceAll('FONT_400', `data:font/woff2;base64,${b64('lib/fonts/HankenGrotesk-Regular.woff2')}`)
  .replaceAll('FONT_800', `data:font/woff2;base64,${b64('lib/fonts/HankenGrotesk-ExtraBold.woff2')}`);

const { chromium } = await import('playwright');
let browser;
try{ browser = await chromium.launch(); }
catch{
  const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
  browser = await chromium.launch({ executablePath: exe });
}
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);   // Hanken Grotesk must be decoded before the shot
const out = join(ROOT, 'site/assets/og-image.png');
await page.screenshot({ path: out });
await browser.close();
console.log(`site/assets/og-image.png written (1200×630)`);
