// Shared by the authoring app, offline recipient and Node exporter. No IO or eval.
export const SCHEMA = 'lazy-tour/1';
export const MATERIAL_KINDS = ['paint', 'plaster', 'brick', 'fluted', 'wood', 'weave', 'leather'];
export const ITEM_KINDS = [
  'desk',
  'chair',
  'sofa',
  'cabinet',
  'table',
  'roundTable',
  'plant',
  'glb',
];
export const FIXTURE_KINDS = ['socket', 'switch', 'panel', 'spot'];
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const newId = (prefix) =>
  prefix +
  '-' +
  (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 12);
export const catalogItems = (p) => p.catalogs.flatMap((c) => c.items);
export const catalogItem = (p, id) => catalogItems(p).find((i) => i.id === id);
export const wallLength = (w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
export const polygonArea = (pts) =>
  Math.abs(
    pts.reduce((a, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return a + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x, min = -100000, max = 100000) =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
const point = (x) => Array.isArray(x) && x.length === 2 && x.every((v) => num(v));
const idOk = (x) =>
  typeof x === 'string' &&
  /^[a-zA-Z0-9_-]{1,80}$/.test(x) &&
  !['__proto__', 'constructor', 'prototype'].includes(x);
const nameOk = (x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 200;
export function wallPoint(w, s, side = 0) {
  const L = wallLength(w),
    dx = (w.b[0] - w.a[0]) / L,
    dy = (w.b[1] - w.a[1]) / L;
  return [w.a[0] + s * dx - dy * side, w.a[1] + s * dy + dx * side];
}
export function projectOnWall(w, p) {
  const L = wallLength(w),
    dx = w.b[0] - w.a[0],
    dy = w.b[1] - w.a[1];
  const offset = Math.max(0, Math.min(L, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / L));
  const at = wallPoint(w, offset);
  return { offset, point: at, distance: Math.hypot(p[0] - at[0], p[1] - at[1]) };
}
export function fixturePosition(p, f) {
  if (!f.wallId) return [f.x, f.y];
  const w = p.walls.find((w) => w.id === f.wallId);
  return wallPoint(w, f.offset, (f.side || 1) * (w.thickness / 2 + 1));
}
export function bounds(p) {
  const pts = p.walls.flatMap((w) => [w.a, w.b]).concat(p.rooms.flatMap((r) => r.polygon));
  if (!pts.length) return [0, 0, 600, 450];
  return [
    Math.min(...pts.map((p) => p[0])),
    Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])),
  ];
}
export function itemPolygon(p, it) {
  const a = catalogItem(p, it.assetId),
    [w, d] = a.size,
    c = Math.cos((it.rotation * Math.PI) / 180),
    s = Math.sin((it.rotation * Math.PI) / 180);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([x, y]) => [it.x + x * c - y * s, it.y + x * s + y * c]);
}
export function itemBounds(p, it) {
  const pts = itemPolygon(p, it);
  return [
    Math.min(...pts.map((x) => x[0])),
    Math.min(...pts.map((x) => x[1])),
    Math.max(...pts.map((x) => x[0])),
    Math.max(...pts.map((x) => x[1])),
  ];
}
export function pointInPolygon(pt, poly) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > pt[1] !== b[1] > pt[1] &&
      pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentCross(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < -1e-8 && cross(c, d, a) * cross(c, d, b) < -1e-8;
}
function simplePolygon(ps) {
  for (let i = 0; i < ps.length; i++) {
    if (
      Math.hypot(ps[i][0] - ps[(i + 1) % ps.length][0], ps[i][1] - ps[(i + 1) % ps.length][1]) < 1
    )
      return false;
    for (let j = i + 2; j < ps.length; j++) {
      if (i === 0 && j === ps.length - 1) continue;
      if (segmentCross(ps[i], ps[(i + 1) % ps.length], ps[j], ps[(j + 1) % ps.length]))
        return false;
    }
  }
  return true;
}

export function validateProject(p) {
  const errors = [],
    need = (ok, msg) => {
      if (!ok) errors.push(msg);
    };
  if (!obj(p)) return ['Проект должен быть JSON-объектом'];
  need(p.schema === SCHEMA, 'Неизвестный формат проекта');
  need(p.units === 'cm', 'Единицы проекта должны быть сантиметрами');
  need(['author', 'recipient'].includes(p.mode), 'Неизвестный режим проекта');
  need(
    obj(p.meta) && idOk(p.meta.id) && nameOk(p.meta.name),
    'Нужны идентификатор и название проекта',
  );
  for (const k of ['walls', 'rooms', 'instances', 'fixtures', 'materials', 'catalogs'])
    if (!Array.isArray(p[k])) errors.push(k + ': нужен массив');
  if (errors.length) return errors;
  need(p.walls.length > 0 && p.walls.length <= 500, 'Нужно от 1 до 500 стен');
  need(p.rooms.length > 0 && p.rooms.length <= 100, 'Нужно от 1 до 100 помещений');
  need(
    p.instances.length <= 1000 && p.fixtures.length <= 300,
    'Слишком много объектов в одном проекте',
  );
  need(
    p.fixtures.filter((f) => f && ['panel', 'spot'].includes(f.kind)).length <= 16,
    'В одном туре допускается до 16 источников света',
  );
  const ids = new Set(),
    checkId = (v, label) => {
      need(idOk(v) && !ids.has(v), label + ': неверный или повторный id');
      ids.add(v);
    };
  const mats = new Set(),
    items = new Map(),
    walls = new Map();
  for (const m of p.materials) {
    if (!obj(m)) {
      errors.push('Некорректный материал');
      continue;
    }
    checkId(m.id, 'Материал');
    mats.add(m.id);
    need(
      nameOk(m.name) && MATERIAL_KINDS.includes(m.kind),
      'Неизвестный тип или название материала',
    );
    need(/^#[a-fA-F0-9]{6}$/.test(m.color), 'Цвет материала: #RRGGBB');
    need(
      num(m.roughness, 0.04, 1) && num(m.scaleCm, 0.5, 1000) && num(m.reliefMm, 0, 30),
      'Проверьте шероховатость, масштаб и рельеф материала',
    );
  }
  for (const c of p.catalogs) {
    if (!obj(c) || !Array.isArray(c.items)) {
      errors.push('Каталог должен содержать items');
      continue;
    }
    checkId(c.id, 'Каталог');
    need(nameOk(c.name), 'Нужно название каталога');
    for (const i of c.items) {
      if (!obj(i)) {
        errors.push('Некорректное изделие');
        continue;
      }
      checkId(i.id, 'Изделие');
      items.set(i.id, i);
      need(ITEM_KINDS.includes(i.kind) && nameOk(i.name), 'Неизвестный тип или название изделия');
      need(
        Array.isArray(i.size) && i.size.length === 3 && i.size.every((n) => num(n, 1, 5000)),
        'Габариты изделия: ширина, глубина, высота в см',
      );
      need(mats.has(i.material), 'Изделие ссылается на неизвестный материал');
      if (i.kind === 'glb') need(idOk(i.model), 'GLB: нужен идентификатор файла');
    }
  }
  for (const w of p.walls) {
    if (!obj(w)) {
      errors.push('Некорректная стена');
      continue;
    }
    checkId(w.id, 'Стена');
    walls.set(w.id, w);
    const validPts = point(w.a) && point(w.b);
    need(validPts, 'Концы стены: две точки [x, y]');
    need(validPts && wallLength(w) >= 10, 'Стена короче 10 см');
    need(
      num(w.thickness, 2, 100) && num(w.height, 20, 2000),
      'Толщина или высота стены вне диапазона',
    );
    need(mats.has(w.material), 'Неизвестный материал стены');
    if (!Array.isArray(w.openings)) {
      errors.push('Нужен массив проёмов стены');
      continue;
    }
    const sorted = [];
    for (const o of w.openings) {
      if (!obj(o)) {
        errors.push('Некорректный проём');
        continue;
      }
      checkId(o.id, 'Проём');
      need(['door', 'window', 'open'].includes(o.type), 'Неизвестный тип проёма');
      const ok =
        validPts &&
        num(o.offset, 0, 100000) &&
        num(o.width, 10, 3000) &&
        o.offset + o.width <= wallLength(w) + 0.001 &&
        num(o.sill, 0, w.height) &&
        num(o.height, 10, w.height) &&
        o.sill + o.height <= w.height;
      need(ok, 'Стена ' + w.id + ': проём выходит за границы стены');
      if (o.type !== 'window') need(o.sill === 0, 'Дверной проём начинается от пола');
      need(o.hinge === undefined || ['s', 'e'].includes(o.hinge), 'Неверная сторона петель');
      need(o.swing === undefined || [-1, 1].includes(o.swing), 'Неверная сторона открывания');
      sorted.push(o);
    }
    sorted.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++)
      need(
        sorted[i].offset >= sorted[i - 1].offset + sorted[i - 1].width + 1,
        'Проёмы стены ' + w.id + ' перекрываются или не имеют простенка',
      );
  }
  for (const r of p.rooms) {
    if (!obj(r)) {
      errors.push('Некорректное помещение');
      continue;
    }
    checkId(r.id, 'Помещение');
    const ok =
      Array.isArray(r.polygon) &&
      r.polygon.length >= 3 &&
      r.polygon.length <= 100 &&
      r.polygon.every(point);
    need(
      ok && polygonArea(r.polygon) > 100 && simplePolygon(r.polygon),
      'Контур помещения должен быть простым многоугольником',
    );
    need(nameOk(r.name) && mats.has(r.material), 'Проверьте название и отделку пола');
  }
  for (const it of p.instances) {
    if (!obj(it)) {
      errors.push('Некорректный предмет');
      continue;
    }
    checkId(it.id, 'Предмет');
    need(items.has(it.assetId), 'Предмет отсутствует в каталоге');
    need(
      num(it.x) && num(it.y) && num(it.z, 0, 2000) && num(it.rotation, -36000, 36000),
      'Проверьте координаты и поворот предмета',
    );
  }
  for (const f of p.fixtures) {
    if (!obj(f)) {
      errors.push('Некорректная точка оборудования');
      continue;
    }
    checkId(f.id, 'Оборудование');
    need(FIXTURE_KINDS.includes(f.kind), 'Неизвестный тип оборудования');
    need(num(f.height, 0, 2000), 'Неверная высота оборудования');
    if (f.wallId) {
      const w = walls.get(f.wallId);
      need(
        w && point(w.a) && point(w.b) && num(f.offset, 0, wallLength(w)),
        'Точка подключения выходит за стену',
      );
      need([-1, 1].includes(f.side), 'Неверная сторона стены для оборудования');
    } else need(num(f.x) && num(f.y), 'Нужны координаты оборудования');
    if (['panel', 'spot'].includes(f.kind)) {
      need(
        num(f.temperature, 2000, 10000) && num(f.power, 0, 100),
        'Проверьте температуру и мощность света',
      );
      if (f.kind === 'panel')
        need(num(f.width, 5, 500) && num(f.depth, 5, 500), 'Неверный размер панели');
    }
  }
  need(obj(p.assets), 'Нужен словарь файлов');
  if (obj(p.assets)) {
    let bytes = 0;
    for (const [key, a] of Object.entries(p.assets)) {
      need(
        idOk(key) &&
          obj(a) &&
          ['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary'].includes(a?.mime) &&
          typeof a?.data === 'string' &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(a.data),
        'Некорректный вложенный файл ' + key,
      );
      if (typeof a?.data === 'string') bytes += a.data.length * 0.75;
    }
    need(bytes <= 50 * 1024 * 1024, 'Файлы проекта превышают 50 МБ');
    for (const m of p.materials)
      if (obj(m))
        for (const k of ['texture', 'normal', 'roughnessMap'])
          if (m[k])
            need(p.assets[m[k]]?.mime?.startsWith('image/'), 'Не найдена карта материала ' + m[k]);
    for (const i of items.values())
      if (i.kind === 'glb')
        need(p.assets[i.model]?.mime === 'model/gltf-binary', 'Не найдена GLB-модель ' + i.model);
  }
  need(
    obj(p.selection) && Array.isArray(p.selection.items) && Array.isArray(p.selection.materials),
    'Нужен состав экспортируемого каталога',
  );
  if (obj(p.selection)) {
    for (const id of Array.isArray(p.selection.items) ? p.selection.items : [])
      need(items.has(id), 'Выбрано неизвестное изделие');
    for (const id of Array.isArray(p.selection.materials) ? p.selection.materials : [])
      need(mats.has(id), 'Выбран неизвестный материал');
  }
  need(
    obj(p.lighting) &&
      ['day', 'work', 'sunset', 'evening'].includes(p.lighting.preset) &&
      num(p.lighting.naturalTemperature, 2000, 10000) &&
      num(p.lighting.naturalPower, 0, 3) &&
      num(p.lighting.exposure, 0.3, 2),
    'Некорректные настройки света',
  );
  need(
    obj(p.policy) &&
      typeof p.policy.furniture === 'boolean' &&
      typeof p.policy.finishes === 'boolean',
    'Нужны настройки доступных действий',
  );
  return errors.slice(0, 50);
}
export function assertProject(p) {
  const errors = validateProject(p);
  if (errors.length) throw new Error(errors.join('\n'));
  return p;
}
export function packageProject(project) {
  assertProject(project);
  const p = clone(project),
    itemIds = new Set([...p.selection.items, ...p.instances.map((i) => i.assetId)]);
  p.catalogs = p.catalogs
    .map((c) => ({ ...c, items: c.items.filter((i) => itemIds.has(i.id)) }))
    .filter((c) => c.items.length);
  const materialIds = new Set([
    ...p.selection.materials,
    ...p.walls.map((w) => w.material),
    ...p.rooms.map((r) => r.material),
    ...catalogItems(p).map((i) => i.material),
  ]);
  p.materials = p.materials.filter((m) => materialIds.has(m.id));
  const assetIds = new Set();
  for (const i of catalogItems(p)) if (i.model) assetIds.add(i.model);
  for (const m of p.materials)
    for (const k of ['texture', 'normal', 'roughnessMap']) if (m[k]) assetIds.add(m[k]);
  p.assets = Object.fromEntries([...assetIds].map((id) => [id, p.assets[id]]));
  p.selection = {
    items: catalogItems(p).map((i) => i.id),
    materials: p.materials.map((m) => m.id),
  };
  p.mode = 'recipient';
  return p;
}
export function packageSummary(p) {
  const q = packageProject(p);
  return {
    items: catalogItems(q).length,
    materials: q.materials.length,
    files: Object.keys(q.assets).length,
    fileBytes: Object.values(q.assets).reduce((n, a) => n + Math.floor(a.data.length * 0.75), 0),
    placed: q.instances.length,
  };
}
const allowedPatch = (value, keys) =>
  Object.fromEntries(Object.entries(value || {}).filter(([k]) => keys.includes(k)));
function update(list, id, patch, keys) {
  const item = list.find((x) => x.id === id);
  if (!item) throw new Error('Объект не найден');
  Object.assign(item, allowedPatch(patch, keys));
  return item;
}
export function applyAction(project, a) {
  const p = clone(project);
  if (!obj(a) || typeof a.type !== 'string') throw new Error('Неизвестное действие');
  if (
    p.mode === 'recipient' &&
    !a.type.startsWith('instance.') &&
    a.type !== 'surface.set' &&
    a.type !== 'lighting.update'
  )
    throw new Error('Это действие доступно только автору проекта');
  if (p.mode === 'recipient' && a.type.startsWith('instance.') && !p.policy.furniture)
    throw new Error('Автор отключил изменение расстановки');
  switch (a.type) {
    case 'meta.update':
      Object.assign(p.meta, allowedPatch(a.patch, ['name']));
      break;
    case 'wall.add':
      p.walls.push(clone(a.wall));
      break;
    case 'wall.update':
      update(p.walls, a.id, a.patch, ['a', 'b', 'thickness', 'height', 'material']);
      break;
    case 'wall.delete':
      p.walls = p.walls.filter((w) => w.id !== a.id);
      p.fixtures = p.fixtures.filter((f) => f.wallId !== a.id);
      break;
    case 'room.add':
      p.rooms.push(clone(a.room));
      break;
    case 'room.update':
      update(p.rooms, a.id, a.patch, ['name', 'polygon', 'material']);
      break;
    case 'room.delete':
      p.rooms = p.rooms.filter((r) => r.id !== a.id);
      break;
    case 'opening.add': {
      const w = p.walls.find((w) => w.id === a.wallId);
      if (!w) throw new Error('Стена не найдена');
      w.openings.push(clone(a.opening));
      break;
    }
    case 'opening.update': {
      const w = p.walls.find((w) => w.id === a.wallId);
      if (!w) throw new Error('Стена не найдена');
      update(w.openings, a.id, a.patch, [
        'type',
        'offset',
        'width',
        'sill',
        'height',
        'hinge',
        'swing',
      ]);
      break;
    }
    case 'opening.delete': {
      const w = p.walls.find((w) => w.id === a.wallId);
      if (w) w.openings = w.openings.filter((o) => o.id !== a.id);
      break;
    }
    case 'instance.add': {
      const def = catalogItem(p, a.assetId);
      if (!def || (p.mode === 'recipient' && !p.selection.items.includes(a.assetId)))
        throw new Error('Изделие отсутствует в доступном каталоге');
      p.instances.push({
        id: newId('item'),
        assetId: a.assetId,
        x: a.x,
        y: a.y,
        z: 0,
        rotation: 0,
      });
      break;
    }
    case 'instance.update':
      update(p.instances, a.id, a.patch, ['x', 'y', 'z', 'rotation']);
      break;
    case 'instance.delete':
      p.instances = p.instances.filter((i) => i.id !== a.id);
      break;
    case 'fixture.add':
      p.fixtures.push(clone(a.fixture));
      break;
    case 'fixture.update':
      update(p.fixtures, a.id, a.patch, [
        'kind',
        'x',
        'y',
        'height',
        'rotation',
        'wallId',
        'offset',
        'side',
        'temperature',
        'power',
        'width',
        'depth',
      ]);
      break;
    case 'fixture.delete':
      p.fixtures = p.fixtures.filter((f) => f.id !== a.id);
      break;
    case 'material.update':
      update(p.materials, a.id, a.patch, [
        'name',
        'color',
        'roughness',
        'scaleCm',
        'reliefMm',
        'texture',
        'normal',
        'roughnessMap',
      ]);
      break;
    case 'catalog.update':
      update(catalogItems(p), a.id, a.patch, ['name', 'size', 'material']);
      break;
    case 'selection.item': {
      if (!catalogItem(p, a.id)) throw new Error('Нет изделия в каталоге');
      if (!a.selected && p.instances.some((i) => i.assetId === a.id))
        throw new Error('Изделие уже стоит на плане. Сначала удалите его экземпляры');
      p.selection.items = [
        ...new Set(
          a.selected ? [...p.selection.items, a.id] : p.selection.items.filter((id) => id !== a.id),
        ),
      ];
      break;
    }
    case 'selection.material':
      p.selection.materials = [
        ...new Set(
          a.selected
            ? [...p.selection.materials, a.id]
            : p.selection.materials.filter((id) => id !== a.id),
        ),
      ];
      break;
    case 'surface.set': {
      if (
        p.mode === 'recipient' &&
        (!p.policy.finishes || !p.selection.materials.includes(a.material))
      )
        throw new Error('Эта отделка недоступна в туре');
      const list = a.target === 'wall' ? p.walls : a.target === 'room' ? p.rooms : null;
      if (!list) throw new Error('Неизвестная поверхность');
      update(list, a.id, { material: a.material }, ['material']);
      break;
    }
    case 'lighting.update':
      Object.assign(
        p.lighting,
        allowedPatch(a.patch, ['preset', 'naturalTemperature', 'naturalPower', 'exposure']),
      );
      break;
    case 'policy.update':
      Object.assign(p.policy, allowedPatch(a.patch, ['furniture', 'finishes']));
      break;
    default:
      throw new Error('Неизвестное действие: ' + a.type);
  }
  return assertProject(p);
}
export function restoreVariant(base, incoming) {
  assertProject(incoming);
  if (base.mode !== 'recipient') return { ...clone(incoming), mode: 'author' };
  const p = clone(base);
  if (!p.policy.furniture && JSON.stringify(incoming.instances) !== JSON.stringify(p.instances))
    throw new Error('Изменение расстановки отключено');
  for (const it of incoming.instances)
    if (!catalogItem(p, it.assetId))
      throw new Error('В варианте есть изделие вне переданного каталога');
  const shape = (q) =>
    JSON.stringify({
      walls: q.walls.map(({ material, ...w }) => w),
      rooms: q.rooms.map(({ material, ...r }) => r),
      fixtures: q.fixtures,
      catalogs: q.catalogs,
      assets: q.assets,
      materials: q.materials,
    });
  if (shape(base) !== shape(incoming))
    throw new Error('Вариант принадлежит другой планировке или меняет состав каталога');
  p.instances = clone(incoming.instances);
  p.lighting = clone(incoming.lighting);
  for (const target of ['walls', 'rooms'])
    for (const obj of p[target]) {
      const mat = incoming[target].find((x) => x.id === obj.id)?.material;
      if (mat !== obj.material) {
        if (!p.policy.finishes || !p.materials.some((m) => m.id === mat))
          throw new Error('Вариант содержит недоступную отделку');
        obj.material = mat;
      }
    }
  return assertProject(p);
}
export function planIssues(p) {
  const out = [];
  for (const it of p.instances) {
    const poly = itemPolygon(p, it),
      name = catalogItem(p, it.assetId).name;
    if (!poly.every((pt) => p.rooms.some((r) => pointInPolygon(pt, r.polygon))))
      out.push(name + ': часть габарита за пределами помещений');
    for (const w of p.walls) {
      if (w.openings.length) continue;
      if (
        poly.some((pt) => projectOnWall(w, pt).distance < w.thickness / 2) ||
        poly.some((pt, i) => segmentCross(pt, poly[(i + 1) % 4], w.a, w.b))
      )
        out.push(name + ': возможное пересечение со стеной');
    }
  }
  return [...new Set(out)];
}
