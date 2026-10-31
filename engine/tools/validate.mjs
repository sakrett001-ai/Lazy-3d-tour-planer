/**
 * Проверка данных проекта до сборки: структура, ссылки на стены и проёмы, типы изделий, материалы, идентификаторы.
 * Возвращает список понятных сообщений; пустой список — данные согласованы.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = f => fs.readFileSync(path.join(ENGINE, 'runtime', f), 'utf8');

export function knownNames(custom = '') {
  const core = src('core-head.js') + src('catalog.js') + custom;
  const types = new Set([...core.matchAll(/(?:CATALOG|CUSTOM)\.([A-Za-z0-9_]+)\s*=/g)].map(m => m[1]));
  const mats = new Set([...core.matchAll(/MAT\.([A-Za-z0-9_]+)\s*=/g)].map(m => m[1]));
  const matBlock = core.slice(core.indexOf('const MAT = {'), core.indexOf('};', core.indexOf('const MAT = {')));
  for (const m of matBlock.matchAll(/^\s*([A-Za-z0-9_]+):/gm)) mats.add(m[1]);
  return { types, mats };
}

// Параметры типов каталога: обязательные (req), допустимые (opt), перечисления (enums).
const SPEC = {
  box: { req: ['mat', 'box'], opt: ['group', 'cast', 'name', 'plan'] }, rbox: { req: ['mat', 'box'], opt: ['r', 'group', 'name', 'plan'] },
  cyl: { req: ['mat', 'at', 'r', 'h'], opt: ['seg', 'r2', 'group', 'cast', 'name', 'plan'] }, blob: { req: ['rect'], opt: ['op', 'h'] },
  plant: { req: ['at'], opt: ['k', 'base'] }, liftFront: { req: ['parts', 'rise'], opt: ['toggleLabel', 'name', 'fitout'] }, planSymbol: { req: ['symbol'] },
  desk: { req: ['rect'], opt: ['h', 'pedestals', 'modesty', 'inlay', 'inlayX0', 'inlayX1'] },
  officeChair: { req: ['at'], opt: ['rot', 'kind', 'plan', 'name'], enums: { kind: ['task', 'exec', 'sled', 'conf'] } },
  monitor: { req: ['at'], opt: ['rot', 'w', 'h', 'name'] }, papers: { req: ['at'], opt: ['n', 'h'] }, deskLamp: { req: ['at'], opt: ['h'] },
  deskPhone: { req: ['at'], opt: ['rot', 'h'] }, printer: { req: ['at'], opt: ['h', 'planText', 'name'] },
  wallScreen: { req: ['at', 'facing', 'w', 'hgt', 'h0'], opt: ['toggleLabel', 'name', 'fitout', 'bar', 'barWidth'], enums: { facing: ['x+', 'x-', 'y+', 'y-'] } },
  sofa: { req: ['rect', 'facing'], opt: ['mat', 'seats', 'name', 'fitout'], enums: { facing: ['N', 'S', 'E', 'W'] } },
  roundSideTable: { req: ['at'], opt: ['d', 'h'] }, diningTable: { req: ['at'], opt: ['d'] }, diningChair: { req: ['at'], opt: ['rot'] },
  meetingTable: { req: ['rect'], opt: ['h', 'legInset', 'mat', 'legMat', 'r'] }, coatRack: { req: ['at'], opt: ['h', 'hooks'] },
  cabinet: { req: ['at', 'W', 'D', 'h'], opt: ['rot', 'plinth', 'body', 'inner', 'frontT', 'upper', 'partitions', 'shelves', 'rods', 'fill', 'doors', 'doorLabel', 'name'] },
  wardrobe: { req: ['at', 'width'], opt: ['rot', 'doorLabel', 'name'] }, documentsCabinet: { req: ['at', 'width', 'depth', 'height'], opt: ['rot', 'doorLabel', 'name'] },
  bookcase: { req: ['at', 'width'], opt: ['rot', 'depth', 'height', 'bays', 'shelves', 'plinth', 'doorsTo', 'body', 'doorLabel', 'name'] },
  refreshmentStation: { req: ['at'], opt: ['rot', 'compact', 'fridgeFront'] }, coffeeMachine: { req: ['at'], opt: ['rot', 'h'] }, kettle: { req: ['at'], opt: ['rot', 'h'] },
  mug: { req: ['at'], opt: ['h'] }, powerSocket: { req: ['at', 'h'], opt: ['rot', 'purpose'] },
  chandelier: { req: ['at'] }, panelLamp: { req: ['at'], opt: ['w', 'd'] }, downLight: { req: ['at'], opt: ['shadow'] },
  beam: { req: ['at', 'z'], opt: ['kind', 'color', 'angle', 'shadow'], enums: { kind: ['panel', 'down', 'task'] } },
  plaque: { req: ['at', 'h', 'text'], opt: ['rot', 'size', 'bg', 'frame', 'ink'] },
  glb: { req: ['src', 'at'], opt: ['rot', 'y', 'scale', 'anchor', 'expect', 'tolerance', 'blob', 'category', 'name'] }
};
const COMMON = new Set(['type', 'id', 'room', 'label', 'rect', 'collision', 'category', 'parts', 'product', 'comment', 'note', 'name', 'fitout', 'seats']);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPt = v => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isRect = v => Array.isArray(v) && v.length === 4 && v.every(isNum) && v[0] <= v[2] && v[1] <= v[3];

export function validateProject(p, custom = '') {
  const out = [], warnings = [], { types, mats } = knownNames(custom);
  const need = (cond, msg) => { if (!cond) out.push(msg); };
  const warn = msg => warnings.push(msg);
  need(p && typeof p === 'object', 'project.json должен быть объектом');
  if (!p || typeof p !== 'object') return out;
  need(p.schema === 'interiors-engine/1', 'schema должен быть "interiors-engine/1"');
  need(p.units === 'cm', 'units: движок работает в сантиметрах ("cm")');
  need(isPt(p.origin), 'origin: [x, y] — центр сцены в сантиметрах плана');
  need(Array.isArray(p.walls) && p.walls.length, 'walls: нужна хотя бы одна стена');
  const walls = new Map();
  for (const [i, w] of (p.walls || []).entries()) {
    const at = `walls[${i}]` + (w.id ? ` (${w.id})` : '');
    need(typeof w.id === 'string' && w.id, `${at}: нужен id`);
    need(!walls.has(w.id), `${at}: id повторяется`);
    need(isPt(w.a) && isPt(w.b), `${at}: a и b — точки [x, y]`);
    need(isNum(w.t) && w.t > 0, `${at}: t — толщина стены, см`);
    const L = isPt(w.a) && isPt(w.b) ? Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) : 0;
    for (const [k, o] of (w.ops || []).entries()) {
      need(['door', 'window', 'arch', 'open'].includes(o.type), `${at}.ops[${k}]: type — door | window | arch | open`);
      need(isNum(o.s) && isNum(o.e) && o.s < o.e && o.s >= 0 && o.e <= L + 0.01, `${at}.ops[${k}]: s < e в пределах длины стены (${L.toFixed(1)} см)`);
      if (o.type === 'window') need(isNum(o.sill) && isNum(o.head) && o.sill < o.head, `${at}.ops[${k}]: окну нужны sill < head`);
      else need(isNum(o.head ?? 215), `${at}.ops[${k}]: head — высота проёма`);
    }
    if (w.mat) need(mats.has(w.mat), `${at}: неизвестный материал ${w.mat}`);
    walls.set(w.id, w);
  }
  for (const [i, d] of (p.doors || []).entries()) {
    const w = walls.get(d.wall);
    need(w, `doors[${i}]: нет стены ${d.wall}`);
    if (w) need((w.ops || []).filter(o => o.type === 'door')[d.op ?? 0], `doors[${i}]: в стене ${d.wall} нет дверного проёма №${d.op ?? 0}`);
    need(['s', 'e', undefined].includes(d.hinge), `doors[${i}]: hinge — "s" (начало стены) или "e" (конец)`);
    if (d.mat) need(mats.has(d.mat), `doors[${i}]: неизвестный материал ${d.mat}`);
  }
  for (const [i, o] of (p.overlays || []).entries()) {
    need(walls.has(o.wall), `overlays[${i}]: нет стены ${o.wall}`);
    need(mats.has(o.mat), `overlays[${i}]: неизвестный материал ${o.mat}`);
  }
  for (const [i, f] of (p.floors || []).entries()) { need(Array.isArray(f.poly) && f.poly.length >= 3 && f.poly.every(isPt), `floors[${i}]: poly — не меньше трёх точек`); need(mats.has(f.mat), `floors[${i}]: неизвестный материал ${f.mat}`); }
  const rooms = new Set();
  need(Array.isArray(p.rooms) && p.rooms.length, 'rooms: нужно хотя бы одно помещение');
  for (const [i, r] of (p.rooms || []).entries()) {
    need(r.id && !rooms.has(r.id), `rooms[${i}]: id пустой или повторяется`); rooms.add(r.id);
    need(isRect(r.rect), `rooms[${i}] (${r.id}): rect — [x0, y0, x1, y1]`);
    need(isPt(r.eye) && isPt(r.look), `rooms[${i}] (${r.id}): eye и look — точки обзора [x, y]`);
  }
  if (p.start) need(rooms.has(p.start), `start: нет помещения ${p.start}`);
  const ids = new Set();
  const checkPart = (part, at, inItem = false) => {
    need(types.has(part.type), `${at}: неизвестный тип изделия "${part.type}" (нет ни в каталоге, ни в custom.js)`);
    const spec = SPEC[part.type];
    if (spec) {
      for (const k of spec.req) need(part[k] !== undefined, `${at}: у типа ${part.type} нет обязательного параметра ${k}`);
      for (const [k, vals] of Object.entries(spec.enums || {})) if (part[k] !== undefined) need(vals.includes(part[k]), `${at}: ${k} = ${JSON.stringify(part[k])}, допустимо ${vals.join(' | ')}`);
      const known = new Set([...spec.req, ...(spec.opt || []), ...COMMON]);
      for (const k of Object.keys(part)) if (!known.has(k)) warn(`${at}: параметр ${k} не используется типом ${part.type} (опечатка?)`);
    }
    if (typeof part.rot === 'string') need(['S', 'N', 'E', 'W'].includes(part.rot), `${at}: rot = "${part.rot}", буквы: S (+y), N (−y), E (+x), W (−x) или угол в градусах`);
    for (const [k, d] of (part.doors || []).entries()) need(['L', 'R', 'S', 'drawer', 'down', 'up'].includes(d.type), `${at}.doors[${k}]: type — L | R | S | drawer | down | up`);
    for (const key of ['mat', 'body', 'fridgeFront']) if (typeof part[key] === 'string' && !part[key].startsWith('book:')) need(mats.has(part[key]), `${at}: неизвестный материал ${part[key]}`);
    for (const [k, d] of (part.doors || []).entries()) if (d.mat) need(mats.has(d.mat), `${at}.doors[${k}]: неизвестный материал ${d.mat}`);
    if (part.rect) need(isRect(part.rect), `${at}: rect — [x0, y0, x1, y1]`);
    if (part.at) need(isPt(part.at), `${at}: at — точка [x, y]`);
  };
  for (const [i, it] of (p.items || []).entries()) {
    const at = `items[${i}]` + (it.id ? ` (${it.id})` : '');
    if (it.id) { need(!ids.has(it.id), `${at}: id повторяется`); ids.add(it.id); need(rooms.has(it.room), `${at}: room "${it.room}" не описано в rooms`); need(it.label, `${at}: нужна подпись label`); }
    if (it.rect) need(isRect(it.rect), `${at}: rect — [x0, y0, x1, y1]`);
    if (it.parts) it.parts.forEach((part, k) => checkPart(part, `${at}.parts[${k}]`, true)); else checkPart(it, at);
  }
  for (const [i, l] of (p.lights || []).entries()) checkPart(l, `lights[${i}]`);
  const viewIds = new Set();
  for (const [i, v] of (p.views || []).entries()) {
    need(v.id && Array.isArray(v.eye) && Array.isArray(v.look), `views[${i}]: нужны id, eye [x, y, z] и look [x, y, z]`); viewIds.add(v.id);
  }
  for (const [i, pg] of (p.booklet?.pages || []).entries()) {
    const refs = [pg.photo, pg.photo?.view, ...(pg.photos || []).map(f => f.view), ...(pg.cameras || [])].filter(x => typeof x === 'string');
    for (const r of refs) need(viewIds.has(r), `booklet.pages[${i}]: нет вида ${r} в views`);
    need(['cover', 'plan', 'room', 'views', 'roomPhoto', 'materials'].includes(pg.type), `booklet.pages[${i}]: type — cover | plan | room | views | roomPhoto | materials`);
    if (pg.room) need(rooms.has(pg.room), `booklet.pages[${i}]: нет помещения ${pg.room}`);
  }
  const itemById = new Map((p.items || []).filter(it => it.id).map(it => [it.id, it]));
  for (const [i, c] of (p.checks?.clearances || []).entries()) for (const k of ['a', 'b']) {
    const it = itemById.get(c[k]);
    need(it, `checks.clearances[${i}].${k}: нет предмета ${c[k]}`);
    if (it) need(it.rect && it.collision !== false, `checks.clearances[${i}].${k}: предмет ${c[k]} должен иметь rect и не быть collision: false — расстояния считаются между статическими предметами`);
  }
  return { errors: out, warnings };
}
