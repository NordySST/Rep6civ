// Teste de gestos multitoque (pinça e arrastar) com eventos de toque reais via CDP.
// Uso: npm run build && npx vite preview --port 4175 & node e2e/pinch.cjs
let pw;
try {
  pw = require('playwright');
} catch {
  pw = require('/opt/node22/lib/node_modules/playwright');
}
const URL = process.env.URL || 'http://localhost:4175/';

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ ...pw.devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.evaluate(() => localStorage.setItem('rep6civ.prefs', JSON.stringify({ tips: false, sound: false, animations: false, largeText: false, seenTips: [] })));
  await page.reload();
  await page.getByText('Novo jogo').click();
  await page.getByText('Começar').click();
  await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);
  const cam = () => page.evaluate(() => window.__rep6civ.camera());
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 })) });
  const vp = page.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height / 2 - 60;
  const fails = [];

  // pinça para aproximar
  const z0 = (await cam()).zoom;
  await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
  for (let k = 1; k <= 10; k++) await touch('touchMove', [[cx - 40 - k * 8, cy], [cx + 40 + k * 8, cy]]);
  await touch('touchEnd', []);
  const z1 = (await cam()).zoom;
  if (!(z1 > z0 * 1.5)) fails.push(`pinça para aproximar: ${z0} → ${z1}`);

  // pinça para afastar
  await touch('touchStart', [[cx - 120, cy], [cx + 120, cy]]);
  for (let k = 1; k <= 10; k++) await touch('touchMove', [[cx - 120 + k * 9, cy], [cx + 120 - k * 9, cy]]);
  await touch('touchEnd', []);
  const z2 = (await cam()).zoom;
  if (!(z2 < z1 * 0.6)) fails.push(`pinça para afastar: ${z1} → ${z2}`);

  // arrastar com um dedo move a câmera e não seleciona nada
  const c0 = await cam();
  await touch('touchStart', [[cx, cy]]);
  for (let k = 1; k <= 10; k++) await touch('touchMove', [[cx - k * 10, cy - k * 5]]);
  await touch('touchEnd', []);
  const c1 = await cam();
  if (!(c1.x > c0.x && c1.y > c0.y)) fails.push(`arrastar: (${c0.x},${c0.y}) → (${c1.x},${c1.y})`);

  await browser.close();
  if (fails.length) {
    console.error('FALHOU:\n' + fails.join('\n'));
    process.exit(1);
  }
  console.log(`OK — zoom ${z0.toFixed(2)} → ${z1.toFixed(2)} → ${z2.toFixed(2)}; câmera moveu ao arrastar.`);
})();
