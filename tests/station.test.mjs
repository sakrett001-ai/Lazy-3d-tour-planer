import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  createRoomProject,
  designBook,
  planSVG,
  furnitureSchedule,
  scheduleCSV,
} from '../src/station.mjs';
import { polygonArea, validateProject, packageProject } from '../src/project.mjs';
const sample = JSON.parse(
  await fs.readFile(new URL('../examples/studio.json', import.meta.url), 'utf8'),
);
test('комната создаётся по внутренним размерам, сохраняя каталог и не меняя исходник', () => {
  const p = createRoomProject(sample, {
    name: 'Гостиная',
    width: 520,
    depth: 380,
    height: 280,
    thickness: 20,
    openings: true,
  });
  assert.deepEqual(validateProject(p), []);
  assert.equal(polygonArea(p.rooms[0].polygon), 520 * 380);
  assert.deepEqual(p.walls[0].a, [-10, -10]);
  assert.equal(p.walls[0].a[1] + p.walls[0].thickness / 2, 0);
  assert.equal(p.walls[1].a[0] - p.walls[1].thickness / 2, 520);
  assert.equal(p.walls.flatMap((w) => w.openings).length, 2);
  assert.equal(p.instances.length, 0);
  assert.equal(p.fixtures.length, 0);
  assert.deepEqual(p.catalogs, sample.catalogs);
  assert.notEqual(p.meta.id, sample.meta.id);
  assert.equal(sample.instances.length, 4);
  assert.throws(
    () =>
      createRoomProject(sample, { name: 'X', width: NaN, depth: 400, height: 280, thickness: 20 }),
    /Ширина/,
  );
});
test('маленькая комната имеет допустимые проёмы; чистый контур можно создать без них', () => {
  const opts = { name: 'Малая', width: 150, depth: 150, height: 200, thickness: 5, openings: true };
  assert.deepEqual(validateProject(createRoomProject(sample, opts)), []);
  assert.equal(
    createRoomProject(sample, { ...opts, openings: false }).walls.flatMap((w) => w.openings).length,
    0,
  );
});
test('книга вариантов делает независимые снимки и сохраняет их при JSON roundtrip', () => {
  const p = structuredClone(sample);
  const book = designBook(p, [{ id: 'v1', name: 'У окна', project: p }]);
  p.instances[0].x += 50;
  assert.equal(book.variants[0].project.instances[0].x, sample.instances[0].x);
  assert.deepEqual(
    designBook(
      ...[JSON.parse(JSON.stringify(book)).project, JSON.parse(JSON.stringify(book)).variants],
    ),
    book,
  );
  const foreign = structuredClone(sample);
  foreign.meta.id = 'other';
  assert.throws(
    () => designBook(p, [{ id: 'v2', name: 'Чужой', project: foreign }]),
    /другому проекту/,
  );
  assert.throws(() => designBook(packageProject(p)), /авторской/);
  assert.throws(
    () =>
      designBook(
        p,
        Array.from({ length: 13 }, (_, i) => ({ id: 'v' + i, name: 'X', project: p })),
      ),
    /12/,
  );
  assert.ok(!JSON.stringify(packageProject(book.project)).includes('У окна'));
});
test('лист и ведомость используют фактические размеры, повороты и количество', () => {
  const p = structuredClone(sample);
  p.instances.push({ ...p.instances[0], id: 'copy-desk', rotation: 90 });
  const rows = furnitureSchedule(p);
  assert.equal(rows.find((r) => r.id === p.instances[0].assetId).count, 2);
  assert.equal(
    rows.reduce((s, r) => s + r.count, 0),
    5,
  );
  p.meta.name = '<script>alert(1)</script>';
  p.catalogs[0].items[0].name = '=HYPERLINK("x")';
  const svg = planSVG(p),
    csv = scheduleCSV(p);
  assert.ok(svg.startsWith('<svg xmlns='));
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('размеры стен по осям'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.startsWith('\ufeff'));
});
