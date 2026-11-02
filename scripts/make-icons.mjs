// Gera os PNGs do PWA a partir de public/icons/icon.svg usando o Chromium do Playwright.
// Uso: node scripts/make-icons.mjs  (os PNGs ficam versionados; só rode ao mudar o ícone)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, name, pad] of [
  [192, 'icon-192.png', 0],
  [512, 'icon-512.png', 0],
  [512, 'icon-maskable-512.png', 0.12],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#0b0f14;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: false });
}
await browser.close();
console.log('ícones gerados');
