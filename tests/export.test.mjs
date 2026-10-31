import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { runtimeBundle, appBundle, createServer } from '../server.mjs';
import { createOfflineHTML, createTourHTML, engineProject } from '../src/compile.mjs';
import { inspectGLB } from '../src/glb.mjs';
import { restoreVariant, packageProject } from '../src/project.mjs';
const require = createRequire(import.meta.url),
  sample = () =>
    fs.readFile(new URL('../examples/studio.json', import.meta.url), 'utf8').then(JSON.parse);
test('экспорт содержит работающий JS и только разрешённый каталог', async () => {
  const p = await sample();
  p.instances = [];
  p.selection.items = ['desk-oak'];
  p.selection.materials = ['plaster'];
  p.meta.name = 'Проверка </script><script>throw 42</script>';
  const html = createOfflineHTML(p, await runtimeBundle(), await appBundle());
  assert.ok(!html.includes('<script>throw 42</script>'));
  assert.ok(html.includes('connect-src data: blob:'));
  assert.ok(!/<link[^>]+href="\/app\//.test(html), 'CSS must be embedded after HTML formatting');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const s of scripts) new vm.Script(s[1]);
  const sandbox = { window: {} };
  vm.runInNewContext(scripts[0][1], sandbox);
  assert.deepEqual(
    [...sandbox.window.LAZY_EMBED.project.catalogs.flatMap((c) => c.items.map((i) => i.id))],
    ['desk-oak'],
  );
  assert.ok(!JSON.stringify(sandbox.window.LAZY_EMBED.project).includes('chair-task'));
});
test('адаптер сохраняет размеры, высоты окон, дверей и светильников', async () => {
  const p = await sample(),
    e = engineProject(p);
  assert.equal(e.walls[0].ops[0].head, 240);
  assert.equal(e.walls[0].H, 300);
  assert.equal(e.doors.length, 1);
  assert.equal(e.lights[0].height, 290);
  assert.equal(e.items[0].rect[2] - e.items[0].rect[0], 160);
});
test('настоящая геометрия Three.js собирается без WebGL', async () => {
  const p = await sample(),
    d = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-scene-'));
  try {
    const f = path.join(d, 'scene.html');
    await fs.writeFile(f, createTourHTML(p, await runtimeBundle()));
    const T = require('../engine/tools/harness.cjs').load(f);
    assert.equal(T.PROJECT_ITEMS.length, 4);
    assert.equal(T.WALLS.length, 4);
    assert.equal(T.LAMPS.length, 2);
    assert.equal(T.PROJECT_ITEMS[0].rect[0], 90);
    assert.ok(T.scene.children.length > 0);
  } finally {
    await fs.rm(d, { recursive: true, force: true });
  }
});
test('получатель не может импортом заменить архитектуру', async () => {
  const p = packageProject(await sample()),
    q = structuredClone(p);
  q.walls[0].height = 700;
  assert.throws(() => restoreVariant(p, q), /планировке/);
});
test('локальный сервер отвергает запросы с другого сайта и путь вне приложения', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal(
      (
        await fetch(base + '/api/export', {
          method: 'POST',
          headers: { origin: 'https://other.example', 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + '/LICENSE')).status, 404);
    assert.equal(
      (
        await fetch(base + '/api/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      400,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('повреждённый и внешний GLB не принимается', () => {
  assert.throws(() => inspectGLB(btoa('bad')), /GLB/);
});
