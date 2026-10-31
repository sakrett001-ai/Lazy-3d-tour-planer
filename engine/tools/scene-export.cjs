/**
 * Выгрузка сцены тура для фоторендера в Blender/Cycles (по образцу студийного режима anatomy).
 *
 *   node tools/scene-export.cjs <тур.html> --out <папка> [--view R3open] [--lighting day]
 *
 * Состояние механизмов — как у вида (двери, open из viewDefaults и вида). Пишет scene.json и scene.bin:
 * мировые треугольники (позиция, нормаль, UV с уже применённым преобразованием текстуры), материалы
 * PBR с картами, светильники, солнце, камеры всех видов. Геометрия — та же, что в туре; не строится заново.
 */
const fs = require('fs'), path = require('path');
const H = require('./harness.cjs');

(async () => {
const args = process.argv.slice(2);
const html = path.resolve(args[0]);
const out = path.resolve(args[args.indexOf('--out') + 1]);
const viewId = args.includes('--view') ? args[args.indexOf('--view') + 1] : null;
fs.mkdirSync(path.join(out, 'textures'), { recursive: true });
const T = H.load(html, { keepTextureUrls: true });
await T.GLB.done;
const { THREE, scene, G, TOG, PROJECT, OX, OZ } = T;
const defaults = PROJECT.viewDefaults || {};
const view = viewId ? (PROJECT.views || []).find(v => v.id === viewId) : null;
if (viewId && !view) throw new Error('Нет вида ' + viewId);
const spec = { ...defaults, ...(view || {}), open: [...new Set([...(defaults.open || []), ...((view || {}).open || [])])] };
const lighting = args.includes('--lighting') ? args[args.indexOf('--lighting') + 1] : (spec.lighting || 'day');
for (const t of TOG) { const open = t.kind === 'door' ? (spec.doors ?? 'open') === 'open' : spec.open.some(k => k === t.label || t.obj.userData.itemId === k); t.cur = t.target = open ? 1 : 0; T.applyTog(t); }
T.setLighting && T.setLighting(lighting);
scene.updateMatrixWorld(true);

// --- текстуры: из data-URI тура, без повторов
const texIndex = new Map(), textures = [];
function textureOf(t) {
  if (!t || !t.userData?.sourceUrl) return null;
  const url = t.userData.sourceUrl;
  if (!texIndex.has(url)) {
    const m = url.match(/^data:([^;]+);base64,(.*)$/s); if (!m) return null;
    const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
    const file = `textures/t${textures.length}.${ext}`; fs.writeFileSync(path.join(out, file), Buffer.from(m[2], 'base64'));
    texIndex.set(url, textures.length); textures.push({ file, srgb: t.colorSpace === THREE.SRGBColorSpace });
  }
  return texIndex.get(url);
}
// --- материалы
const matIndex = new Map(), materials = [];
function materialOf(m) {
  if (matIndex.has(m.uuid)) return matIndex.get(m.uuid);
  const uvSource = m.map || m.normalMap || m.roughnessMap || null;
  if (uvSource) uvSource.updateMatrix();
  const rec = { name: m.name || m.type, color: m.color ? m.color.toArray() : [1, 1, 1], roughness: m.roughness ?? 1, metalness: m.metalness ?? 0,
    emissive: m.emissive ? m.emissive.toArray() : [0, 0, 0], emissiveIntensity: m.emissiveIntensity ?? 0,
    opacity: m.transparent ? (m.opacity ?? 1) : 1, alphaTest: m.alphaTest || 0, transmission: m.transmission || 0, basic: !!m.isMeshBasicMaterial,
    map: textureOf(m.map), normalMap: textureOf(m.normalMap), normalScale: m.normalScale ? m.normalScale.x : 1, roughnessMap: textureOf(m.roughnessMap),
    emissiveMap: textureOf(m.emissiveMap), alphaMap: textureOf(m.alphaMap), sheen: m.sheen || 0, doubleSided: m.side === THREE.DoubleSide };
  rec.uvMatrix = uvSource ? uvSource.matrix.toArray() : null;
  const id = materials.length; materials.push(rec); matIndex.set(m.uuid, id); return id;
}
// --- геометрия: мировые треугольники, Blender Z-up: (x, -z, y)
const chunks = [], parts = []; let offset = 0;
const pos = new THREE.Vector3(), nrm = new THREE.Vector3(), uvv = new THREE.Vector3();
// Совпадающие грани соседних деталей (короба наличников, рамы окон) в Cycles дают чёрные пятна: теневой луч
// с одной грани упирается в соседнюю, лежащую в той же плоскости. Каждый экземпляр слегка «раздувается» от своего
// центра на свою величину (0,03–0,39 мм) — плоскости расходятся, сетка остаётся замкнутой (сдвиг зависит только от позиции).
const SEP = 3e-5; let instanceNo = 0;
const sgn = d => (d > 1e-5 ? 1 : d < -1e-5 ? -1 : 0);
function emit(mesh, matrix, material, group, index, p, n, uv, centre, sep) {
  const id = materialOf(material); const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  const uvM = materials[id].uvMatrix ? new THREE.Matrix3().fromArray(materials[id].uvMatrix) : null;
  const count = group.count, data = new Float32Array(count * 8);
  // Зеркальные детали (scale = -1, например облицовка с обратной стороны стены): обход треугольников меняется
  // на обратный, иначе нормаль грани в Blender смотрит против заданной и поверхность выходит чёрной.
  const mirror = matrix.determinant() < 0;
  for (let k = 0; k < count; k++) {
    const kk = mirror ? k - (k % 3) + [0, 2, 1][k % 3] : k;
    const j = index ? index.getX(kk + group.start) : kk + group.start;
    pos.fromBufferAttribute(p, j).applyMatrix4(matrix);
    pos.x += sep * sgn(pos.x - centre.x); pos.y += sep * sgn(pos.y - centre.y); pos.z += sep * sgn(pos.z - centre.z);
    nrm.fromBufferAttribute(n, j).applyMatrix3(nm).normalize();
    let u = uv ? uv.getX(j) : 0, v = uv ? uv.getY(j) : 0;
    if (uvM) { uvv.set(u, v, 1).applyMatrix3(uvM); u = uvv.x; v = uvv.y; }
    data.set([pos.x, -pos.z, pos.y, nrm.x, -nrm.z, nrm.y, u, v], k * 8);
  }
  chunks.push(Buffer.from(data.buffer)); parts.push({ offset, count, material: id, name: mesh.name || '' }); offset += count;
}
const skip = new Set();
for (const root of [G.interior, G.ceiling, G.exterior, G.trees]) root.traverse(mesh => {
  if (!(mesh.isMesh || mesh.isInstancedMesh) || mesh.userData.batch) return;
  let visible = true; for (let o = mesh; o; o = o.parent) if (!o.visible && !o.userData.batchSource) { visible = false; break; }
  if (!visible) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mats.some(m => m.isShaderMaterial)) { skip.add('shader'); return; }
  if (mats.every(m => m.isMeshBasicMaterial && m.alphaMap)) { skip.add('contact-shadow decals'); return; }   // в Cycles контактные тени настоящие
  const g = mesh.geometry, index = g.index, p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  if (!p || !n) return;
  const groups = Array.isArray(mesh.material) ? g.groups : [{ start: 0, count: index ? index.count : p.count, materialIndex: 0 }];
  const instances = mesh.isInstancedMesh ? mesh.count : 1, im = new THREE.Matrix4();
  if (!g.boundingBox) g.computeBoundingBox();
  for (let k = 0; k < instances; k++) {
    const matrix = mesh.isInstancedMesh ? (mesh.getMatrixAt(k, im), new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, im)) : mesh.matrixWorld;
    const centre = g.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(matrix), sep = SEP * (1 + (instanceNo++ % 13));
    for (const gr of groups) emit(mesh, matrix, mats[gr.materialIndex ?? 0], gr, index, p, n, uv, centre, sep);
  }
});
fs.writeFileSync(path.join(out, 'scene.bin'), Buffer.concat(chunks));

// --- свет и камеры
const mode = T.LIGHT_MODES[lighting];
const lamps = T.LAMPS.map(l => ({ kind: l.kind, position: [l.L.position.x, -l.L.position.z, l.L.position.y], target: [l.L.target.position.x, -l.L.target.position.z, l.L.target.position.y],
  color: l.L.color.toArray(), angle: l.L.angle, intensity: l.L.intensity, distance: l.L.distance }));
const toWorld = (p, zDefault) => [p[0] / 100 - OX, -(p[1] / 100 - OZ), (p[2] ?? zDefault) / 100];
const cameras = (PROJECT.views || []).map(v => ({ id: v.id, title: v.title, eye: toWorld(v.eye, 160), look: toWorld(v.look, 120), fov: v.fov || 62 }));
const sunDir = new THREE.Vector3(...mode.sun).normalize();
const sceneJson = { schema: 'interiors-cycles/1', project: PROJECT.meta?.id, view: viewId, lighting, units: 'm', axes: 'Z-up', vertices: offset, parts, materials, textures,
  sun: { direction: [-sunDir.x, sunDir.z, -sunDir.y], color: new THREE.Color(mode.sunC).toArray(), intensity: mode.sunI },
  sky: { dusk: mode.dusk, hemi: mode.hemiI }, lamps, cameras, lampsScale: mode.lamps, skipped: [...skip] };
fs.writeFileSync(path.join(out, 'scene.json'), JSON.stringify(sceneJson));
console.log(JSON.stringify({ out, view: viewId, lighting, vertices: offset, parts: parts.length, materials: materials.length, textures: textures.length, lamps: lamps.length, skipped: [...skip] }));
})().catch(e => { console.error(e.stack || String(e)); process.exit(1); });
