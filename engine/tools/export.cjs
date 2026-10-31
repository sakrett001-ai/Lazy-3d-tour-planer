/**
 * Выгрузка геометрии собранного тура для плана, буклета и проверок.
 *
 *   node tools/export.cjs <тур.html> --out <папка>
 *
 * Пишет в папку:
 *   model.json   — предметы (габариты по непрозрачной геометрии), условные знаки плана, стены, двери, механизмы, помещения;
 *   layout.json  — вход для check_layout.py навыка (метры): стены, предметы, ход дверей, расстояния, маршруты;
 *   routes.json  — данные для проверки проходимости сеткой (routes.py).
 */
const fs = require('fs'), path = require('path');
const H = require('./harness.cjs');

const args = process.argv.slice(2);
const html = path.resolve(args[0]);
const outDir = path.resolve(args[args.indexOf('--out') + 1] || path.join(path.dirname(html), 'data'));
fs.mkdirSync(outDir, { recursive: true });
(async () => {
const T = H.load(html);
let glbTimer; await Promise.race([T.GLB.done, new Promise((_, rej) => { glbTimer = setTimeout(() => rej(new Error('GLB не загрузились за 120 с')), 120000); })]); clearTimeout(glbTimer);
if (T.GLB.errors.length) { console.error('Ошибки загрузки GLB:\n- ' + T.GLB.errors.join('\n- ')); process.exitCode = 1; }
const { THREE, scene, TOG, WALLS, PROJECT, PROJECT_ITEMS, PLAN_SYMBOLS, ROOMS, SEGS, OX, OZ } = T;
const round = (v, k = 3) => Math.round(v * 10 ** k) / 10 ** k;
const planPoint = v => [round((v.x + OX) * 100), round((v.z + OZ) * 100)];
function bounds(objects) {
  const b = new THREE.Box3();
  for (const o of objects) o.traverse(m => { if (m.isMesh && !m.material.transparent && !m.userData.batch) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
  if (b.isEmpty()) return null;
  return [b.min.x, b.min.z, b.max.x, b.max.z].map((v, i) => round((v + (i % 2 ? OZ : OX)) * 100)).concat([round(b.min.y * 100), round(b.max.y * 100)]);
}
function pose(t, s) { t.cur = s; T.applyTog(t); }
for (const t of TOG) pose(t, 0);
scene.updateMatrixWorld(true);

// --- условные знаки плана
const symbol = s => { const { obj, ...rest } = s; if (s.kind === 'bounds') return { ...rest, kind: 'rect', rect: (bounds([obj]) || []).slice(0, 4) }; return rest; };
// Паспорт изделия: product.sizeCm [ширина, глубина, высота] производителя → сверка с габаритом модели.
function fidelityOf(id, b) {
  const src = (PROJECT.items || []).find(x => x.id === id) || {};
  const product = src.product; if (!product?.sizeCm || !b) return null;
  const rotRaw = src.rot ?? src.parts?.[0]?.rot ?? 0;
  const rot = typeof rotRaw === 'string' ? { S: 0, N: 180, E: 90, W: -90 }[rotRaw] : rotRaw;
  const q = ((rot % 180) + 180) % 180, W = b[2] - b[0], D = b[3] - b[1], Hh = b[5] - b[4];
  const size = Math.abs(q) < 1e-6 ? [W, D, Hh] : Math.abs(q - 90) < 1e-6 ? [D, W, Hh] : null;
  const tol = product.tolerance ?? 0.03;
  const dev = size ? size.map((v, k) => round((v / product.sizeCm[k] - 1) * 100, 1)) : [null, null, round((Hh / product.sizeCm[2] - 1) * 100, 1)];
  return { product: product.name || null, url: product.url || null, expectCm: product.sizeCm, sizeCm: size ? size.map(v => round(v, 1)) : null, deviation: dev,
    ok: dev.every(d => d == null || Math.abs(d) <= tol * 100), note: size ? null : 'предмет повёрнут не на кратный 90° угол: сверена только высота' };
}
const SEAT_WORDS = ['кресло', 'стул', 'диван', 'банкетка', 'пуф'];
const SEAT_TYPES = ['officeChair', 'sofa', 'diningChair'];
const CATALOG_TYPES = new Set(['desk', 'cabinet', 'wardrobe', 'documentsCabinet', 'bookcase', 'roundSideTable', 'diningTable', 'refreshmentStation', 'printer', 'wallScreen', 'glb']);
const items = PROJECT_ITEMS.map(i => {
  const b = bounds(i.objects);
  // категория для заливки плана: явная → по типу изделия → по первому слову подписи
  const first = i.label.toLowerCase().split(/[\s·,]+/)[0];
  const category = i.category || (SEAT_TYPES.includes(i.type) ? 'seat' : i.type && CATALOG_TYPES.has(i.type) ? 'furniture' : SEAT_WORDS.some(w => first.startsWith(w)) ? 'seat' : 'furniture');
  return { id: i.id, room: i.room, label: i.label, type: i.type, category, rect: i.rect, bounds: b, collision: i.collision, plan: i.plan.filter(s => s.kind !== 'bounds').map(symbol), fidelity: fidelityOf(i.id, b) };
});
for (const r of T.GLB.report) { const it = items.find(x => x.id === r.item); if (it && r.expectCm && !it.fidelity) it.fidelity = { product: r.src, expectCm: r.expectCm, sizeCm: r.sizeCm, deviation: r.deviation, ok: r.ok, note: 'габарит GLB в собственных осях модели' }; }
const decor = PLAN_SYMBOLS.map(symbol);

// --- двери: ось, закрытое и открытое положение конца полотна
const doors = [];
for (const t of TOG.filter(t => t.kind === 'door')) {
  const body = t.obj.children.find(x => x.isMesh), w = body.geometry.parameters.width, dir = Math.sign(body.position.x);
  const tip = () => planPoint(new THREE.Vector3(dir * w, 0, 0).applyMatrix4(t.obj.matrixWorld));
  pose(t, 0); scene.updateMatrixWorld(true);
  const pivot = planPoint(t.obj.getWorldPosition(new THREE.Vector3())), closed = tip();
  pose(t, 1); scene.updateMatrixWorld(true);
  const opened = tip(); pose(t, 0); scene.updateMatrixWorld(true);
  doors.push({ wall: t.wallName, label: t.label, pivot, closed, opened, angle: t.open, widthCm: round(w * 100, 2), thicknessCm: round(body.geometry.parameters.depth * 100, 2), heightCm: round(body.geometry.parameters.height * 100, 2), startOpen: t.target > .5 });
}
scene.updateMatrixWorld(true);

// --- механизмы: двери, дверцы, ящики, подъёмные фасады, экраны
const mechanisms = TOG.map(t => ({ label: t.label, kind: t.kind || (t.axis === 'fn' ? 'function' : t.axis === 'pz' ? 'drawer' : t.axis === 'px' ? 'sliding' : 'flap'),
  item: (() => { let o = t.obj; while (o && !o.userData.itemId) o = o.parent; return o?.userData.itemId || null; })(),
  openDeg: t.axis === 'y' || t.axis === 'x' ? round(t.open * 180 / Math.PI, 2) : null, requestedDeg: t.requestedOpen != null ? round(t.requestedOpen * 180 / Math.PI, 2) : null, wallStop: t.wallStop || null }));

const walls = WALLS.map(w => ({ id: w.name, a: w.a, b: w.b, t: w.t, H: w.H, ops: w.ops }));
const rooms = ROOMS.map(r => ({ id: r.id, name: r.name, rect: r.r, eye: r.eye, look: r.look, hidden: !!r.hidden, quick: !!r.quick, planColor: r.planColor, planRect: r.planRect, planLabel: r.planLabel, planName: r.planName, dims: r.dims }));
const model = { schema: 'interiors-model/1', project: PROJECT.meta?.id, version: PROJECT.meta?.version, date: PROJECT.meta?.date, units: 'cm', bounds: T.PROJECT_BOUNDS,
  meta: PROJECT.meta || {}, items, decor, walls, doors, mechanisms, rooms, views: PROJECT.views || [], plan: PROJECT.plan || {},
  sheet: PROJECT.sheet || {}, booklet: PROJECT.booklet || {}, models: T.GLB.report, stats: T.RENDER_STATS };
fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify(model, null, 1));

// --- вход для check_layout.py (метры)
const m = v => round(v / 100, 4);
const objects = [];
// Участок оси стены w внутри прямоугольника стены v (Лян — Барский в осях v): для обрезки примыканий.
function insideInterval(w, v) {
  const toV = p => { const dx = p[0] - v.a[0], dy = p[1] - v.a[1]; return [dx * v.dir[0] + dy * v.dir[1], dx * v.nrm[0] + dy * v.nrm[1]]; };
  const p0 = toV(w.a), p1 = toV(w.b), d = [p1[0] - p0[0], p1[1] - p0[1]];
  let t0 = 0, t1 = 1;
  for (const [pk, dk, lo, hi] of [[p0[0], d[0], 0, v.L], [p0[1], d[1], -v.t / 2, v.t / 2]]) {
    if (Math.abs(dk) < 1e-9) { if (pk <= lo || pk >= hi) return null; continue; }
    let a = (lo - pk) / dk, b = (hi - pk) / dk; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 >= t1) return null;
  }
  return [t0 * w.L, t1 * w.L];
}
for (const [j, w] of WALLS.entries()) {
  // стена с меньшим номером проходит сквозь угол; у следующих вырезается участок примыкания
  const holes = [];
  for (const v of WALLS.slice(0, j)) { const iv = insideInterval(w, v); if (iv) holes.push(iv); }
  const solid = T.subtract(0, w.L, holes.sort((p, q) => p[0] - q[0]));
  const cuts = [...new Set([...solid.flat(), ...w.ops.filter(o => o.type !== 'window').flatMap(o => [o.s, o.e])])].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
    if (!solid.some(([s, e]) => mid > s && mid < e)) continue;
    const op = w.ops.find(o => o.type !== 'window' && mid > o.s && mid < o.e);
    if (op && op.type !== 'door' && op.type !== 'arch') continue;
    const z0 = op ? (op.type === 'arch' ? op.spring + op.rise : op.head) : 0;
    const len = b - a; if (len < 0.5) continue;
    const c = T.wp(w, mid, 0);
    objects.push({ id: `wall:${w.name}:${i}`, center: [m(c[0]), m(c[1])], size: [m(len), m(w.t)], rotation_deg: round(w.th * 180 / Math.PI, 4), z: [m(z0), m(w.H)] });
  }
}
// Предметы со столкновениями; кресла у столов (collision: false) не берутся — сплошной габарит дал бы ложное пересечение.
const included = new Set(PROJECT.checks?.objects || items.filter(i => i.collision && i.rect).map(i => i.id));
for (const i of items) if (included.has(i.id) && i.bounds) {
  const b = i.bounds; objects.push({ id: i.id, center: [m((b[0] + b[2]) / 2), m((b[1] + b[3]) / 2)], size: [m(b[2] - b[0]), m(b[3] - b[1])], z: [m(Math.max(0, b[4])), m(b[5])] });
}
const deg = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI;
const norm = a => ((a + 540) % 360) - 180;
const layoutDoors = doors.map((d, k) => ({ id: `door:${d.wall}`, hinge: [m(d.pivot[0]), m(d.pivot[1])], width: m(d.widthCm), thickness: m(d.thicknessCm), z: [0.01, m(d.heightCm)],
  closed_angle_deg: round(deg(d.pivot, d.closed), 3), open_angle_deg: round(norm(deg(d.pivot, d.opened) - deg(d.pivot, d.closed)), 3), sample_step_deg: 0.5 }));
const xs = walls.flatMap(w => [w.a[0], w.b[0]]), ys = walls.flatMap(w => [w.a[1], w.b[1]]), pad = Math.max(...walls.map(w => w.t)) + 10;
const layout = { units: 'm', bounds: [m(Math.min(...xs) - pad), m(Math.min(...ys) - pad), m(Math.max(...xs) + pad), m(Math.max(...ys) + pad)], objects, doors: layoutDoors,
  clearances: (PROJECT.checks?.clearances || []).map(c => ({ a: c.a, b: c.b, min_m: c.min_m ?? c.minCm / 100 })),
  routes: (PROJECT.checks?.routes || []).map(r => ({ id: r.id, points: r.points.map(p => [m(p[0]), m(p[1])]), radius_m: (r.radiusCm ?? 22) / 100, z: [0, 1.8], door_angles_deg: r.doorAnglesDeg || {} })) };
fs.writeFileSync(path.join(outDir, 'layout.json'), JSON.stringify(layout, null, 1));

// --- данные для проверки проходимости: двери открыты, фасады закрыты
for (const t of TOG) pose(t, t.kind === 'door' ? 1 : 0);
scene.updateMatrixWorld(true);
const segments = SEGS.concat(T.dynamicSegments()).map(s => s.map(v => round(v, 2)));
const seats = decor.filter(s => s.category === 'seat' && s.rect && s.rect.length === 4).map(s => s.rect);
fs.writeFileSync(path.join(outDir, 'routes.json'), JSON.stringify({ segments, items: items.filter(i => i.bounds).map(i => ({ id: i.id, bounds: i.bounds })), seats,
  rooms, start: PROJECT.start || rooms[0]?.id, checks: PROJECT.checks || {}, bounds: T.PROJECT_BOUNDS }));
for (const t of TOG) pose(t, 0);
console.log(JSON.stringify({ out: outDir, items: items.length, decorSymbols: decor.length, doors: doors.length, mechanisms: mechanisms.length, layoutObjects: objects.length }));
})().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
