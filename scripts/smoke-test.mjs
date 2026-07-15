// smoke-test.mjs — the platform's pre-push gate (advisory in CI; never a
// deploy gate — see docs/AUTOMATION.md).
//
// Serves the repo root and drives, at desktop (1280×800) AND mobile
// (390×780) viewports, with zero tolerated pageerrors/console errors:
//   1. site/            — the launcher: grid renders every catalog app,
//                         ingest failures degrade gracefully (no network
//                         here, so the static cards ARE the offline path)
//   2. lib/demo/        — the shell kitchen sink, once per palette
//
//   node scripts/smoke-test.mjs
//
// Requires playwright + chromium. WebKit runs too when available (iOS
// engine; catches Intl/date bugs V8 tolerates) and is skipped with a
// warning where it isn't installed.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = process.cwd();
const PORT = 4179;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.json':'application/json', '.png':'image/png', '.webmanifest':'application/manifest+json' };

function serve(){
  return http.createServer(async (req, res) => {
    try{
      let p = decodeURIComponent(req.url.split('?')[0]);
      if(p.endsWith('/')) p += 'index.html';
      const data = await readFile(join(ROOT, p.replace(/^\//, '')));
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(data);
    }catch{ res.writeHead(404); res.end('not found'); }
  });
}

const VIEWPORTS = [
  { label: 'desktop', viewport: { width: 1280, height: 800 } },
  { label: 'mobile',  viewport: { width: 390,  height: 780 }, isMobile: true },
];

async function checkPage(browser, vp, url, asserts, label){
  const ctx = await browser.newContext(vp.isMobile ? { viewport: vp.viewport, isMobile: true } : { viewport: vp.viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if(m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  await asserts(page);
  if(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
    throw new Error(`[${label} ${vp.label}] page overflows horizontally`);
  const real = errors.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e));
  await page.close(); await ctx.close();
  if(real.length) throw new Error(`[${label} ${vp.label}] errors:\n  ` + real.join('\n  '));
  console.log(`✓ ${label} (${vp.label})`);
}

(async () => {
  const { chromium, webkit } = await import('playwright');
  const server = serve();
  await new Promise(r => server.listen(PORT, r));
  // If the pinned playwright wants a browser build the environment doesn't
  // have, fall back to the environment's own chromium binary.
  let cr;
  try{ cr = await chromium.launch(); }
  catch{
    const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
    cr = await chromium.launch({ executablePath: exe });
  }
  const browsers = [['chromium', cr]];
  try{
    const wk = await webkit.launch();
    browsers.push(['webkit', wk]);
  }catch{ console.warn('⚠ webkit not installed — skipping the iOS-engine pass'); }

  let code = 0;
  try{
    for(const [bname, browser] of browsers){
      for(const vp of VIEWPORTS){
        // 1) launcher
        await checkPage(browser, vp, `http://localhost:${PORT}/site/`, async page => {
          await page.waitForSelector('.app-card', { timeout: 12000 });
          const n = await page.locator('.app-card').count();
          if(n < 5) throw new Error(`launcher grid rendered only ${n} cards`);
          // Sign in must open a VISIBLE dialog (regression: the modal once
          // rendered unstyled because this page doesn't load shell.css)
          await page.locator('#signInBtn').click();
          await page.waitForSelector('.modal-back.in .modal', { timeout: 5000 });
          await page.waitForTimeout(300); // let the 200ms fade-in settle
          const visible = await page.evaluate(() => {
            const m = document.querySelector('.modal');
            if(!m) return false;
            const r = m.getBoundingClientRect();
            const cs = getComputedStyle(m.closest('.modal-back'));
            return r.width > 200 && r.height > 100 && cs.position === 'fixed' && +cs.opacity > .9;
          });
          if(!visible) throw new Error('sign-in modal is not visibly styled');
          await page.keyboard.press('Escape');
        }, `${bname}:launcher`);

        // 2) shell demo, every palette × both modes
        for(const palette of ['polecat', 'aurora', 'neon']){
          for(const mode of ['dark', 'light']){
            await checkPage(browser, vp, `http://localhost:${PORT}/lib/demo/?palette=${palette}&mode=${mode}`, async page => {
              await page.waitForSelector('.ps-rail, #rail', { timeout: 12000 });
              const visible = await page.evaluate(() =>
                [...document.querySelectorAll('main *, .ps-main *')].some(e => {
                  const r = e.getBoundingClientRect();
                  return r.height >= 24 && r.width >= 60;
                }));
              if(!visible) throw new Error('demo main renders no visible content');
            }, `${bname}:demo/${palette}/${mode}`);
          }
        }
      }
    }
    console.log('\n✅ smoke test passed');
  }catch(e){
    console.error('\n❌ smoke test FAILED:\n' + e.message);
    code = 1;
  }finally{
    for(const [, b] of browsers) await b.close();
    server.close();
  }
  process.exit(code);
})();
