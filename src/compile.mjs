import {
  packageProject,
  assertProject,
  catalogItem,
  bounds,
  itemBounds,
  fixturePosition,
  polygonArea,
  clone,
  pointInPolygon,
  projectOnWall,
} from './project.mjs';
import { inspectGLB, assertAssetDimensions } from './glb.mjs';

export const scriptJSON = (x) =>
  JSON.stringify(x)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export const htmlText = (x) =>
  String(x ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const safeScript = (x) => x.replace(/<\/script/gi, '<\\/script');
// Scan horizontal polygon bands, including narrow/concave rooms. Prefer an
// interior corner view with clearance from walls and furniture at eye height.
export function roomViewpoint(p, r) {
  const ys = [...new Set(r.polygon.map((v) => v[1]))].sort((a, b) => a - b),
    points = [];
  const rectangles = p.instances
    .filter((it) => it.z < 180 && it.z + catalogItem(p, it.assetId).size[2] > 20)
    .map((it) => itemBounds(p, it));
  for (let j = 1; j < ys.length; j++)
    for (const fraction of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      const y = ys[j - 1] + (ys[j] - ys[j - 1]) * fraction,
        xs = [];
      r.polygon.forEach((a, i) => {
        const b = r.polygon[(i + 1) % r.polygon.length];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      });
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (const t of [0.15, 0.35, 0.5, 0.65, 0.85])
          points.push([xs[i] + (xs[i + 1] - xs[i]) * t, y]);
    }
  const b = [
    Math.min(...r.polygon.map((p) => p[0])),
    ys[0],
    Math.max(...r.polygon.map((p) => p[0])),
    ys.at(-1),
  ];
  const target = [b[0] + (b[2] - b[0]) * 0.8, b[1] + (b[3] - b[1]) * 0.8],
    center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const clearance = (pt) =>
    Math.min(
      ...p.walls.map((w) => projectOnWall(w, pt).distance - w.thickness / 2),
      ...rectangles.map((b) => Math.max(b[0] - pt[0], pt[0] - b[2], b[1] - pt[1], pt[1] - b[3])),
    );
  const inside = points.filter((pt) => pointInPolygon(pt, r.polygon)),
    free = inside.filter((pt) => clearance(pt) >= 24);
  const eye =
    (free.length
      ? free.sort((a, b) => dist(a, target) - dist(b, target))
      : inside.sort((a, b) => clearance(b) - clearance(a)))[0] || r.polygon[0];
  const look = inside
    .filter((pt) => dist(pt, eye) > 30)
    .sort((a, b) => dist(a, center) - dist(b, center))[0] || [eye[0] + 1, eye[1]];
  return { eye, look };
}
export function engineProject(input) {
  const p = assertProject(input),
    b = bounds(p),
    origin = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2],
    height = Math.max(...p.walls.map((w) => w.height));
  const rooms = p.rooms.map((r) => {
    const xs = r.polygon.map((p) => p[0]),
      ys = r.polygon.map((p) => p[1]),
      rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return {
      id: r.id,
      name: r.name,
      rect,
      ...roomViewpoint(p, r),
      planName: r.name,
    };
  });
  return {
    schema: 'interiors-engine/1',
    units: 'cm',
    meta: {
      id: p.meta.id,
      title: p.meta.name,
      heading: 'Lazy 3D',
      loading: 'Подготавливаем пространство…',
      storageKey: 'lazy-preview-' + p.meta.id,
    },
    origin,
    ceiling: height,
    start: rooms[0].id,
    walls: p.walls.map((w) => ({
      id: w.id,
      a: w.a,
      b: w.b,
      t: w.thickness,
      H: w.height,
      mat: 'lazy_' + w.material,
      sides: [],
      noSkirt: true,
      ops: w.openings.map((o) => ({
        type: o.type,
        s: o.offset,
        e: o.offset + o.width,
        sill: o.sill,
        head: o.sill + o.height,
      })),
      windows: { inSide: 1, sill: 'whiteMatte', transom: false },
    })),
    floors: p.rooms.map((r) => ({ poly: r.polygon, mat: 'lazy_' + r.material, main: false })),
    ceilings: p.rooms.map((r) => ({ poly: r.polygon, mat: 'ceiling', h: height })),
    doors: p.walls.flatMap((w) =>
      w.openings
        .filter((o) => o.type === 'door')
        .map((o, i) => ({
          wall: w.id,
          op: i,
          hinge: o.hinge || 's',
          swing: o.swing || 1,
          angle: 90,
          mat: 'doorLeaf',
          open: false,
          casing: [1, -1],
        })),
    ),
    rooms,
    items: p.instances.map((it) => {
      const def = catalogItem(p, it.assetId);
      return {
        id: it.id,
        room: rooms[0].id,
        label: def.name,
        type: 'plannerItem',
        rect: itemBounds(p, it),
        collision: true,
        at: [it.x, it.y],
        z: it.z,
        rot: it.rotation,
        definition: def,
      };
    }),
    lights: p.fixtures.map((f) => ({ ...f, type: 'plannerFixture', at: fixturePosition(p, f) })),
    exterior: { type: 'none' },
    planner: {
      materials: p.materials,
      walls: p.walls,
      fixtures: p.fixtures,
      lighting: p.lighting,
      version: 1,
    },
    finishes: { defaults: { lighting: p.lighting.preset } },
    checks: { radiusCm: 22, gridCm: 10 },
  };
}
export function createTourHTML(input, bundle) {
  const p = assertAssetDimensions(packageProject(input)),
    ep = engineProject(p),
    models = {},
    textures = {};
  for (const [id, a] of Object.entries(p.assets)) {
    if (a.mime === 'model/gltf-binary') {
      inspectGLB(a.data);
      models[id] = a.data;
    } else textures[id] = 'data:' + a.mime + ';base64,' + a.data;
  }
  const reportError = `addEventListener('error',e=>{const el=document.getElementById('loading');if(el){el.textContent='3D не запустился: '+e.message+'. План доступен в соседней вкладке.';el.classList.remove('done');}parent.postMessage({type:'lazy-render-error',message:e.message},'*');});`;
  const finish = `
if(!window.LAZY_TEXTURE_REQUESTS){texReady=true;document.getElementById('loading').classList.add('done');}
document.getElementById('help').hidden=true;
window.TOUR.setMode('orbit');window.TOUR.setLighting(PROJECT.planner.lighting.preset);
window.TOUR.scene=scene;window.TOUR.renderer=renderer;window.TOUR.camera=camera;
window.TOUR.snapshot=()=>({mode,orbit:{...orbit},walk:{...walk}});
window.TOUR.restore=s=>{if(s?.orbit)Object.assign(orbit,s.orbit);if(s?.walk)Object.assign(walk,s.walk);if(s?.mode)setMode(s.mode);dirty=true;};
parent.postMessage({type:'lazy-render-ready',items:PROJECT_ITEMS.length},'*');
`;
  const blocks = [
    `<script>${reportError}</script>`,
    `<script id="three-js">${safeScript(bundle.three)}</script>`,
    ...(Object.keys(models).length
      ? [`<script id="gltf-addons">${safeScript(bundle.gltf)}</script>`]
      : []),
    `<script id="tour-assets">window.TOUR_ASSETS=${scriptJSON(models)};</script>`,
    `<script id="tour-textures">window.TOUR_TEX=${scriptJSON(textures)};window.TOUR_TEXTURE_POLICY='subset';</script>`,
    `<script id="tour-project">window.TOUR_PROJECT=${scriptJSON(ep)};</script>`,
    `<script id="tour-engine">${safeScript(bundle.head + '\n' + bundle.catalog + '\n' + bundle.extensions + '\n' + bundle.tail + '\n' + finish)}</script>`,
  ];
  let html = bundle.shell;
  for (const [k, v] of Object.entries({
    TITLE: p.meta.name,
    LOADING: 'Подготавливаем пространство…',
    MARK: 'L',
    KICKER: 'Lazy 3D',
    HEADING: p.meta.name,
    PROJECT_TITLE: p.meta.name,
    HELP_TITLE: 'Прогулка',
    HELP_GO: 'Войти',
    HELP_EXTRA: '',
  }))
    html = html.split('{{' + k + '}}').join(htmlText(v));
  html = html.replace(
    '</head>',
    '<style>#loading.done{display:none!important}#title,#panelBtn,#captureBtn,#panel{display:none!important}#top{justify-content:flex-end}#rooms{bottom:8px}#roomName{display:none}#help{display:none!important}</style></head>',
  );
  return html.split('{{SCRIPTS}}').join(blocks.join('\n'));
}
export function createOfflineHTML(input, bundle, app) {
  const p = assertAssetDimensions(packageProject(input));
  const classic = (s) => s.replace(/^import\s[\s\S]*?;\s*/gm, '').replace(/^export /gm, '');
  const code = [classic(app.domain), classic(app.glb), classic(app.compiler), classic(app.js)].join(
    '\n',
  );
  const embed = { project: p, bundle, app };
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; frame-src blob:; child-src blob:; connect-src data: blob:; font-src data:;">`;
  let html = app.html.replace(
    /<link\s+rel="stylesheet"\s+href="\/app\/style\.css"\s*\/?>/,
    () => '<style>' + app.css + '</style>',
  );
  html = html.replace(
    '<script type="module" src="/app/app.mjs"></script>',
    () =>
      `<script>window.LAZY_EMBED=${scriptJSON(embed)};</script><script>${safeScript(code)}</script>`,
  );
  return html.replace('</head>', policy + '</head>');
}
