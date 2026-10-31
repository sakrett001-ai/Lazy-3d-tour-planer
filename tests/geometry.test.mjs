import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runtimeBundle } from '../server.mjs';
import { createTourHTML, engineProject } from '../src/compile.mjs';
import {
  catalogItems,
  itemBounds,
  validateProject,
  pointInPolygon,
  restoreVariant,
  packageProject,
} from '../src/project.mjs';
import { inspectGLB } from '../src/glb.mjs';
import { boxGLB } from './fixtures.mjs';
const require = createRequire(import.meta.url),
  sample = () =>
    fs.readFile(new URL('../examples/studio.json', import.meta.url), 'utf8').then(JSON.parse);
test('все семь изделий сохраняют габариты, центр и опору на пол', async () => {
  const p = await sample();
  p.instances = catalogItems(p).map((a, i) => ({
    id: 'test-' + i,
    assetId: a.id,
    x: 80 + i * 50,
    y: 230,
    z: i * 3,
    rotation: 0,
  }));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-bounds-'));
  try {
    const file = path.join(dir, 'scene.html');
    await fs.writeFile(file, createTourHTML(p, await runtimeBundle()));
    const T = require('../engine/tools/harness.cjs').load(file);
    T.scene.updateMatrixWorld(true);
    for (const it of p.instances) {
      const entry = T.PROJECT_ITEMS.find((i) => i.id === it.id),
        b = new T.THREE.Box3().setFromObject(entry.objects[0]),
        actual = [
          (b.min.x + T.OX) * 100,
          (b.min.z + T.OZ) * 100,
          (b.max.x + T.OX) * 100,
          (b.max.z + T.OZ) * 100,
        ],
        expected = itemBounds(p, it);
      for (let k = 0; k < 4; k++)
        assert.ok(
          Math.abs(actual[k] - expected[k]) < 0.05,
          `${it.assetId}: габарит ${actual} вместо ${expected}`,
        );
      assert.ok(Math.abs(b.min.y * 100 - it.z) < 0.05, it.assetId + ': высота нижней точки');
    }
    // Fluted-wall pieces must stay beside the wall, rather than float a metre away.
    const relief = T.G.interior.children.filter((o) => o.userData.plannerRelief);
    assert.ok(relief.length > 0);
    for (const o of relief) {
      const b = new T.THREE.Box3().setFromObject(o);
      assert.ok(b.min.x + T.OX >= -0.109 && b.max.x + T.OX <= 0.109, 'рейка смещена от стены');
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('вход в L-образную комнату остаётся внутри её контура', async () => {
  const p = await sample();
  p.instances = [];
  p.rooms[0].polygon = [
    [0, 0],
    [600, 0],
    [600, 150],
    [150, 150],
    [150, 600],
    [0, 600],
  ];
  p.walls = p.rooms[0].polygon.map((a, i, poly) => ({
    id: 'wall' + i,
    a,
    b: poly[(i + 1) % poly.length],
    thickness: 20,
    height: 300,
    material: 'plaster',
    openings: [],
  }));
  p.fixtures = [];
  const eye = engineProject(p).rooms[0].eye;
  assert.ok(pointInPolygon(eye, p.rooms[0].polygon));
  assert.ok(eye[0] < 150 || eye[1] < 150);
});
test('автор может открыть вариант и продолжить редактирование архитектуры', async () => {
  const p = await sample(),
    recipient = packageProject(p);
  assert.equal(restoreVariant(p, recipient).mode, 'author');
});
test('импорт измеряет реальные вершины GLB и преобразования узлов', () => {
  const result = inspectGLB(boxGLB().toString('base64'));
  assert.deepEqual(result.size, [100, 60, 80]);
  assert.equal(result.triangles, 12);
  assert.deepEqual(
    inspectGLB(boxGLB((j) => (j.nodes[0].scale = [2, 1, 0.5])).toString('base64')).size,
    [200, 30, 80],
  );
});
test('внешние текстуры и обязательный Draco отклоняются до рендера', () => {
  assert.throws(
    () =>
      inspectGLB(
        boxGLB((j) => (j.images = [{ uri: 'https://example.org/map.png' }])).toString('base64'),
      ),
    /Внешние/,
  );
  assert.throws(
    () =>
      inspectGLB(
        boxGLB((j) => (j.extensionsRequired = ['KHR_draco_mesh_compression'])).toString('base64'),
      ),
    /Draco/,
  );
});
test('неверные типы selection не выбрасывают необработанное исключение', async () => {
  for (const value of [3, {}, null, 'bad']) {
    const p = await sample();
    p.selection = { items: value, materials: value };
    assert.ok(validateProject(p).length);
  }
});
