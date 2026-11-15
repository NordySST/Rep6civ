#!/usr/bin/env node
/**
 * Gera public/leaders/<civ>.webp (retratos dos líderes) renderizando a mesma cena 3D da
 * tela de diplomacia num Chromium sem janela (Playwright + WebGL por software).
 * Uso: node scripts/render-portraits.mjs [tamanho=256]
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = createRequire('/opt/node22/lib/node_modules/')('playwright');
}
const size = Number(process.argv[2] || 256);
const port = 5197;
const vite = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await playwright.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(`http://localhost:${port}/scripts/portraits.html?size=${size}`);
  await page.waitForFunction('window.portraits', null, { timeout: 120000 });
  const all = await page.evaluate('window.portraits');
  for (const [id, url] of Object.entries(all)) {
    if (!url) continue;
    const buf = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(`public/leaders/${id}.webp`, buf);
    console.log(`${id}.webp ${(buf.length / 1024).toFixed(1)} kB`);
  }
} finally {
  await browser.close();
  await vite.close();
}
