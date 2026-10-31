import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { texturedBoxGLB } from './fixtures.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve('test-results');
await fs.mkdir(out, { recursive: true });
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: process.env.CHROMIUM_EXECUTABLE
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : [],
});
const errors = [],
  report = { checks: [], renderer: null };
const watch = (p) => p.on('pageerror', (e) => errors.push(e.message));
const ok = (name) => {
  report.checks.push(name);
  console.log('PASS', name);
};
const project = (p) => p.evaluate(() => window.LAZY.getProject());
async function position(p, x, y) {
  return p.locator('#plan').evaluate(
    (svg, [x, y]) => {
      const pt = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
      return { x: pt.x, y: pt.y };
    },
    [x, y],
  );
}
async function clickPlan(p, x, y) {
  const pt = await position(p, x, y);
  await p.mouse.click(pt.x, pt.y);
}
async function edit(p, key, value) {
  const field = p.locator('[data-edit="' + key + '"]');
  await field.fill(String(value));
  await field.press('Tab');
}
async function ready3D(p) {
  const el = await p.locator('#tourFrame').elementHandle(),
    actual = await el.contentFrame();
  await actual.waitForFunction(() => window.TOUR?.ready, {}, { timeout: 30000 });
  const frame = p.locator('#tourFrame').contentFrame();
  await frame.locator('#loading').waitFor({ state: 'hidden', timeout: 30000 });
  assert.equal(await p.locator('#plan').isVisible(), false);
  assert.deepEqual(await actual.evaluate(() => window.TOUR.models.errors), []);
  return frame;
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  watch(page);
  await page.goto(base);
  await page.waitForFunction(() => window.LAZY);
  await page.screenshot({ path: path.join(out, 'desktop.png') });
  assert.equal((await project(page)).walls.length, 4);
  await clickPlan(page, 170, 150);
  await edit(page, 'x', 235);
  await edit(page, 'rotation', 90);
  assert.equal((await project(page)).instances[0].x, 235);
  assert.equal((await project(page)).instances[0].rotation, 90);
  await page.locator('#undo').click();
  assert.equal((await project(page)).instances[0].rotation, 0);
  await page.locator('#redo').click();
  assert.equal((await project(page)).instances[0].rotation, 90);
  await page.keyboard.press('Escape');
  await page.locator('[data-tool="select"]').click();
  const a = await position(page, 235, 150),
    b = await position(page, 270, 180);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  assert.equal((await project(page)).instances[0].x, 270);
  ok('Координаты, поворот, undo/redo и перетаскивание мебели');
  await page.locator('[data-tool="wall"]').click();
  await clickPlan(page, 400, 280);
  await clickPlan(page, 400, 410);
  await page.keyboard.press('Escape');
  assert.equal((await project(page)).walls.length, 5);
  await page.locator('#undo').click();
  assert.equal((await project(page)).walls.length, 4);
  ok('Построение стены и отмена');
  await page.locator('[data-tool="window"]').click();
  await clickPlan(page, 600, 280);
  assert.equal((await project(page)).walls[1].openings.length, 1);
  await edit(page, 'height', 130);
  const before = JSON.stringify(await project(page));
  await edit(page, 'width', 9999);
  assert.equal(JSON.stringify(await project(page)), before);
  ok('Окно, точная высота и отказ при выходе проёма за стену');
  await page.keyboard.press('Escape');
  await clickPlan(page, 190, 180);
  await edit(page, 'temperature', 2700);
  await edit(page, 'height', 280);
  assert.equal((await project(page)).fixtures[0].temperature, 2700);
  ok('Температура и высота источника света');
  await page.locator('#modelFile').setInputFiles({
    name: 'test-box.glb',
    mimeType: 'model/gltf-binary',
    buffer: texturedBoxGLB(),
  });
  await page.waitForFunction(() =>
    window.LAZY.getProject().catalogs.some((c) => c.id === 'imported'),
  );
  await clickPlan(page, 350, 330);
  assert.equal((await project(page)).instances.length, 5);
  ok('Импорт настоящего GLB и размещение');
  await page.locator('[data-include="table-meeting"]').uncheck();
  await page.locator('[data-include="plant-tall"]').uncheck();
  const saved = page.waitForEvent('download');
  await page.locator('#saveProject').click();
  const download = await saved;
  const jsonPath = path.join(out, 'saved-project.json');
  await download.saveAs(jsonPath);
  assert.deepEqual(JSON.parse(await fs.readFile(jsonPath, 'utf8')), await project(page));
  ok('Сохранение JSON без потери данных');
  await page.locator('[data-view="3d"]').click();
  let frame = await ready3D(page);
  assert.deepEqual(await frame.locator('body').evaluate(() => window.TOUR.models.errors), []);
  assert.equal(await frame.locator('body').evaluate(() => window.TOUR.models.report.length), 1);
  report.renderer = await frame.locator('body').evaluate(() => {
    const r = window.TOUR.renderer;
    const gl = r.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      webglVersion: gl.getParameter(gl.VERSION),
    };
  });
  await page.screenshot({ path: path.join(out, '3d.png') });
  await frame.locator('body').evaluate(() => window.TOUR.go(0));
  await page.screenshot({ path: path.join(out, 'walk.png') });
  const lighting = await frame.locator('body').evaluate(() => {
    const t = window.TOUR,
      previous = t.scene.environment.uuid;
    t.setLighting('evening');
    const result = {
      environmentChanged: previous !== t.scene.environment.uuid,
      sun: t.scene.children.find((o) => o.isDirectionalLight).intensity,
    };
    t.setLighting('day');
    return result;
  });
  assert.equal(lighting.environmentChanged, true);
  assert.equal(lighting.sun, 0);
  ok('WebGL, готовность моделей, обзор и прогулка');
  const dl = page.waitForEvent('download');
  await page.locator('#exportTour').click();
  const tour = await dl;
  const htmlPath = path.join(out, 'recipient.html');
  await tour.saveAs(htmlPath);
  const offline = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const network = [];
  await offline.route(/^https?:/, (route) => {
    network.push(route.request().url());
    return route.abort();
  });
  const recipient = await offline.newPage();
  watch(recipient);
  await recipient.goto(pathToFileURL(htmlPath).href);
  await recipient.waitForFunction(() => window.LAZY);
  await ready3D(recipient);
  const texture = await recipient
    .locator('#tourFrame')
    .contentFrame()
    .locator('body')
    .evaluate(() => {
      let result = false;
      window.TOUR.scene.traverse((o) => {
        if (
          o.isMesh &&
          o.userData.itemId?.startsWith('item-') &&
          o.material?.map?.image?.width === 2
        )
          result = true;
      });
      return result;
    });
  assert.equal(texture, true, 'GLB texture survived offline export');
  const pack = await project(recipient);
  assert.equal(pack.mode, 'recipient');
  assert.ok(
    !pack.catalogs
      .flatMap((c) => c.items)
      .some((i) => ['table-meeting', 'plant-tall'].includes(i.id)),
  );
  assert.equal(await recipient.locator('[data-tool="wall"]').isVisible(), false);
  await recipient.locator('[data-view="plan"]').click();
  await clickPlan(recipient, 270, 180);
  await recipient.screenshot({ path: path.join(out, 'recipient-click.png') });
  await edit(recipient, 'x', 310);
  assert.equal((await project(recipient)).instances[0].x, 310);
  await recipient.locator('[data-place="table-round"]').click();
  await clickPlan(recipient, 400, 340);
  assert.equal((await project(recipient)).instances.length, 6);
  await recipient.screenshot({ path: path.join(out, 'recipient.png') });
  const variant = await project(recipient),
    bad = structuredClone(variant);
  bad.walls[0].height = 500;
  await recipient.locator('#projectFile').setInputFiles({
    name: 'invalid-variant.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bad)),
  });
  await recipient.locator('#notice').filter({ hasText: 'другой планировке' }).waitFor();
  assert.deepEqual(await project(recipient), variant);
  await recipient.locator('#projectFile').setInputFiles({
    name: 'valid-variant.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(variant)),
  });
  await recipient.locator('#notice').filter({ hasText: 'Проект открыт' }).waitFor();
  assert.deepEqual(await project(recipient), variant);
  assert.deepEqual(network, []);
  ok(
    'Автономный HTML: выбранный каталог, расстановка, импорт варианта, отсутствие сетевых запросов',
  );
  const repack = await recipient.evaluate(() => window.LAZY.exportHTML());
  const repackPath = path.join(out, 'repacked.html');
  await fs.writeFile(repackPath, repack);
  const reopened = await offline.newPage();
  watch(reopened);
  await reopened.goto(pathToFileURL(repackPath).href);
  await reopened.waitForFunction(() => window.LAZY);
  await ready3D(reopened);
  assert.deepEqual((await project(reopened)).instances, variant.instances);
  ok('Повторная выгрузка автономного тура сохраняет вариант');
  await offline.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  watch(mobile);
  await mobile.goto(base);
  await mobile.waitForFunction(() => window.LAZY);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: path.join(out, 'mobile.png') });
  await mobile.locator('#showLibrary').click();
  await mobile.locator('[data-place="table-round"]').click();
  await clickPlan(mobile, 350, 330);
  assert.equal((await project(mobile)).instances.length, 5);
  if (!(await mobile.locator('#properties').isVisible()))
    await mobile.locator('#showInspector').click();
  await mobile.screenshot({ path: path.join(out, 'mobile-properties.png') });
  assert.equal(await mobile.locator('#properties').isVisible(), true);
  ok('Узкий экран: без горизонтального переполнения, библиотека, размещение и свойства');
  assert.equal(await mobile.locator('#openProject').isVisible(), true);
  const chooser = mobile.waitForEvent('filechooser');
  await mobile.locator('#openProject').click();
  await (await chooser).setFiles(jsonPath);
  await mobile.waitForFunction(() => window.LAZY.getProject().instances.length === 5);
  ok('Открытие сохранённого проекта на телефоне');
  await page.locator('[data-view="plan"]').click();
  await page.locator('#issuesButton').click();
  await page.locator('[data-command="new"]').click();
  await page.locator('#newDesignForm button[type="submit"]').click();
  await page.locator('#projectName').fill('Проверка восстановления');
  await page.locator('#projectName').press('Tab');
  const savedID = (await project(page)).meta.id;
  await page.waitForFunction((id) => {
    const p = JSON.parse(localStorage.getItem('Lazy3D-v1-author-last'));
    return p?.meta.id === id && p.meta.name === 'Проверка восстановления';
  }, savedID);
  await page.reload();
  await page.waitForFunction(() => window.LAZY);
  assert.equal((await project(page)).meta.id, savedID);
  assert.equal((await project(page)).meta.name, 'Проверка восстановления');
  ok('Новый проект восстанавливается после перезагрузки');
  assert.deepEqual(errors, []);
  report.pageErrors = errors;
  report.externalRequests = network;
  await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
