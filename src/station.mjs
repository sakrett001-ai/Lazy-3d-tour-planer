import {
  clone,
  newId,
  assertProject,
  bounds,
  polygonArea,
  catalogItem,
  wallPoint,
  wallLength,
  itemPolygon,
  fixturePosition,
} from './project.mjs';
import { htmlText, roomViewpoint } from './compile.mjs';

// A design workbook is an author-only container. Recipient exports receive only
// packageProject(activeProject); snapshots never enter the tour's data payload.
export function designBook(project, variants = []) {
  assertProject(project);
  if (project.mode !== 'author') throw new Error('Варианты доступны в авторской станции');
  if (!Array.isArray(variants) || variants.length > 12)
    throw new Error('Сохраните не более 12 вариантов');
  const seen = new Set();
  for (const v of variants) {
    if (!v || typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v.id) || seen.has(v.id))
      throw new Error('Некорректный идентификатор варианта');
    seen.add(v.id);
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 120)
      throw new Error('Название варианта: от 1 до 120 символов');
    assertProject(v.project);
    if (v.project.mode !== 'author' || v.project.meta.id !== project.meta.id)
      throw new Error('Вариант относится к другому проекту');
  }
  return clone({ schema: 'lazy-station/1', project, variants });
}

export function createRoomProject(source, options) {
  const p = clone(assertProject(source));
  if (p.mode !== 'author') throw new Error('Новый проект доступен автору');
  const { width, depth, height, thickness } = options;
  for (const [label, value, min, max] of [
    ['Ширина', width, 150, 3000],
    ['Глубина', depth, 150, 3000],
    ['Высота', height, 200, 600],
    ['Толщина стены', thickness, 5, 60],
  ])
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`${label}: от ${min} до ${max} см`);
  const name = String(options.name || 'Новый интерьер').trim();
  p.meta = { ...p.meta, id: newId('project'), name };
  // Room dimensions are clear internal dimensions. Walls sit outside the floor.
  const t = thickness / 2;
  const corners = [
    [-t, -t],
    [width + t, -t],
    [width + t, depth + t],
    [-t, depth + t],
  ];
  const wallMat = p.materials.find((m) => m.kind === 'plaster')?.id || p.materials[0].id;
  const floorMat = p.materials.find((m) => m.kind === 'wood')?.id || p.materials[0].id;
  p.walls = corners.map((a, i) => ({
    id: newId('wall'),
    a,
    b: corners[(i + 1) % 4],
    thickness,
    height,
    material: wallMat,
    openings: [],
  }));
  p.rooms = [
    {
      id: newId('room'),
      name,
      polygon: [
        [0, 0],
        [width, 0],
        [width, depth],
        [0, depth],
      ],
      material: floorMat,
    },
  ];
  if (options.openings) {
    p.walls[0].openings.push({
      id: newId('window'),
      type: 'window',
      offset: (width + thickness - 100) / 2,
      width: 100,
      height: Math.min(140, height - 95),
      sill: 85,
    });
    p.walls[2].openings.push({
      id: newId('door'),
      type: 'door',
      offset: (width + thickness - 90) / 2,
      width: 90,
      height: Math.min(210, height),
      sill: 0,
      hinge: 's',
      swing: 1,
    });
  }
  p.instances = [];
  p.fixtures = [];
  p.lighting = { ...p.lighting, preset: 'day' };
  return assertProject(p);
}

export function furnitureSchedule(project) {
  const p = assertProject(project),
    counts = new Map();
  p.instances.forEach((it) => counts.set(it.assetId, (counts.get(it.assetId) || 0) + 1));
  return [...counts].map(([id, count]) => {
    const a = catalogItem(p, id);
    return {
      id,
      name: a.name,
      count,
      size: a.size.slice(),
      material: p.materials.find((m) => m.id === a.material).name,
    };
  });
}

export function scheduleCSV(project) {
  const cell = (value) =>
    '"' +
    String(value)
      .replace(/^(?:\s*[=+@\-]|[\t\r\n])/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return (
    '\ufeff' +
    [
      ['Изделие', 'Количество', 'Ширина, см', 'Глубина, см', 'Высота, см', 'Материал'],
      ...furnitureSchedule(project).map((r) => [r.name, r.count, ...r.size, r.material]),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  );
}

export function planSVG(project) {
  const p = assertProject(project),
    b = bounds(p),
    pad = Math.max(65, Math.max(b[2] - b[0], b[3] - b[1]) * 0.08);
  const box = [b[0] - pad, b[1] - pad, b[2] - b[0] + pad * 2, b[3] - b[1] + pad * 2];
  const poly = (pts) => pts.map((pt) => pt.join(',')).join(' ');
  const line = (a, b, color, width) =>
    `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${width}"/>`;
  let drawing = '';
  for (const [i, r] of p.rooms.entries()) {
    const label = roomViewpoint(p, r).eye;
    drawing += `<polygon points="${poly(r.polygon)}" fill="${p.materials.find((m) => m.id === r.material).color}" fill-opacity=".15"/>`;
    drawing += `<text x="${label[0]}" y="${label[1]}" text-anchor="middle" font-size="12">П${i + 1} · ${(polygonArea(r.polygon) / 10000).toFixed(1)} м²</text>`;
  }
  for (const w of p.walls) {
    drawing += line(w.a, w.b, '#3b5146', w.thickness);
    for (const o of w.openings) {
      const a = wallPoint(w, o.offset),
        end = wallPoint(w, o.offset + o.width);
      drawing += line(a, end, '#fffefa', w.thickness + 1);
      if (o.type === 'window') drawing += line(a, end, '#548d9f', 3);
      else {
        const hinge = o.hinge === 'e' ? end : a,
          start = o.hinge === 'e' ? a : end;
        const angle = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]),
          side = o.swing || 1;
        const leaf = [
          hinge[0] - Math.sin(angle) * side * o.width,
          hinge[1] + Math.cos(angle) * side * o.width,
        ];
        drawing +=
          line(hinge, leaf, '#798c7f', 2) +
          `<path d="M${start} A${o.width} ${o.width} 0 0 ${side * (o.hinge === 'e' ? -1 : 1) > 0 ? 1 : 0} ${leaf}" fill="none" stroke="#a1afa3"/>`;
      }
    }
    const mid = wallPoint(w, wallLength(w) / 2, -w.thickness / 2 - 17);
    drawing += `<text x="${mid[0]}" y="${mid[1]}" text-anchor="middle" font-size="12">${Math.round(wallLength(w))} см</text>`;
  }
  p.instances.forEach((it, i) => {
    const a = catalogItem(p, it.assetId),
      mat = p.materials.find((m) => m.id === a.material);
    drawing += `<polygon points="${poly(itemPolygon(p, it))}" fill="${mat.color}" fill-opacity=".65" stroke="#506b5d" stroke-width="1.5"/><text x="${it.x}" y="${it.y + 5}" text-anchor="middle" font-size="15">${i + 1}</text>`;
  });
  for (const f of p.fixtures) {
    const pt = fixturePosition(p, f),
      lamp = ['panel', 'spot'].includes(f.kind);
    drawing += `<circle cx="${pt[0]}" cy="${pt[1]}" r="${lamp ? 8 : 5}" fill="${lamp ? '#e2ba6b' : '#fff'}" stroke="${lamp ? '#a67933' : '#527180'}" stroke-width="2"/>`;
  }
  const area = p.rooms.reduce((sum, r) => sum + polygonArea(r.polygon), 0) / 10000;
  const names = [
    ...p.rooms.map((r, i) => `П${i + 1}. ${r.name}`),
    ...p.instances.map((it, i) => `${i + 1}. ${catalogItem(p, it.assetId).name}`),
  ];
  const legendHeight = Math.ceil(names.length / 3) * 22;
  const svgHeight = 780 + legendHeight;
  const legend = names
    .map(
      (name, i) =>
        `<text x="${32 + (i % 3) * 370}" y="${760 + Math.floor(i / 3) * 22}" font-size="12">${htmlText(name.slice(0, 42))}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${svgHeight}" viewBox="0 0 1200 ${svgHeight}" role="img" aria-label="План ${htmlText(p.meta.name)}"><rect width="100%" height="100%" fill="#fffefa"/><g font-family="Arial, sans-serif" fill="#23352f"><text x="32" y="34" font-size="12" letter-spacing="2">LAZY 3D / ПЛАНИРОВОЧНОЕ РЕШЕНИЕ</text><text x="32" y="70" font-size="26">${htmlText(p.meta.name.slice(0, 65))}</text><text x="32" y="97" font-size="13">${area.toFixed(1)} м² · ${p.rooms.length} пом. · ${p.instances.length} предметов · размеры стен по осям, см</text><svg x="32" y="120" width="1136" height="580" viewBox="${box.join(' ')}">${drawing}<path d="M${box[0] + 10} ${box[1] + box[3] - 15}h100m-100 -4v8m100-8v8" fill="none" stroke="#23352f" stroke-width="2"/><text x="${box[0] + 60}" y="${box[1] + box[3] - 24}" text-anchor="middle" font-size="11">1 м</text></svg><text x="32" y="726" font-size="11" fill="#66766c">Эскиз для обсуждения. Проверьте обмеры перед реализацией. Мебель — номера; свет — охра; электроустановочные изделия — синий.</text>${legend}</g></svg>`;
}
