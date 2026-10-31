'use strict';
/* Движок интерьерных туров · ядро. Проект описан данными (window.TOUR_PROJECT):
   план в сантиметрах по внутренним граням стен, высоты в сантиметрах, x вправо, y вниз по плану. */
const PROJECT = window.TOUR_PROJECT;
const TEX = window.TOUR_TEX || {};
const S = 0.01, OX = PROJECT.origin[0] * S, OZ = PROJECT.origin[1] * S, HC = PROJECT.ceiling || 300;
const WX = x => x * S - OX, WZ = y => y * S - OZ;
const V2 = THREE.Vector2, V3 = THREE.Vector3;

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6ea);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
let dirty = true;


/* ---------- текстуры ---------- */
const manager = new THREE.LoadingManager();
let texReady = false;
manager.onLoad = () => { texReady = true; dirty = true; document.getElementById('loading').classList.add('done'); };
manager.onError = () => { document.getElementById('loading').textContent = 'Не удалось загрузить текстуру. Распакуйте архив и откройте HTML ещё раз.'; };
const loader = new THREE.TextureLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const MISSING_TEX = [];
// Отсутствующая текстура не ломает сборку: материал получает белую карту, ключ попадает в отчёт.
function blankTexture(key) {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  if(window.TOUR_TEXTURE_POLICY==='subset'&&key.endsWith('_n'))t.image.data.set([128,128,255,255]);
  t.needsUpdate = true; t.userData.missing = key; if(window.TOUR_TEXTURE_POLICY!=='subset')MISSING_TEX.push(key); return t;
}
function tex(key, o = {}) {
  if(TEX[key])window.LAZY_TEXTURE_REQUESTS=(window.LAZY_TEXTURE_REQUESTS||0)+1;
  const t = TEX[key] ? loader.load(TEX[key]) : blankTexture(key);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(o.rx || 1, o.ry || 1);
  if (o.rot) { t.center.set(.5, .5); t.rotation = o.rot; }
  t.colorSpace = o.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, maxAniso);
  return t;
}
const ALL_MATS = [];
function std(o) { const m = new THREE.MeshStandardMaterial(o); m.userData.env = o.envMapIntensity ?? 1; ALL_MATS.push(m); return m; }

/* ---------- материалы ---------- */
const plasterN = tex('plaster_n', { data: true, rx: .6, ry: .6 });
const MAT = {
  wall: std({ color: 0xf1ede5, roughness: .93, normalMap: plasterN, normalScale: new V2(.1, .1) }),
  ceiling: std({ color: 0xfbfaf7, roughness: 1, envMapIntensity: 2.2 }),
  spc: std({ map: tex('spc', { rx: 1 / 2.44, ry: 1 / 1.22 }), normalMap: tex('spc_n', { data: true, rx: 1 / 2.44, ry: 1 / 1.22 }), normalScale: new V2(.32, .32),
             roughnessMap: tex('spc_r', { data: true, rx: 1 / 2.44, ry: 1 / 1.22 }), roughness: 1, envMapIntensity: .7 }),
  oakFloor: std({ map: tex('oak', { rx: 1 / 1.8, ry: 1 / 1.8 }), normalMap: tex('oak_n', { data: true, rx: 1 / 1.8, ry: 1 / 1.8 }), normalScale: new V2(.5, .5), color: 0xe9d6b8, roughness: .62, envMapIntensity: .7 }),
  tile: std({ map: tex('tile', { rx: 1 / 1.2, ry: 1 / 1.2 }), normalMap: tex('tile_n', { data: true, rx: 1 / 1.2, ry: 1 / 1.2 }), normalScale: new V2(.35, .35), roughness: .32, envMapIntensity: .9 }),
  tileWall: std({ map: tex('tile', { rx: 1 / 1.2, ry: 1 / 1.2, rot: Math.PI / 2 }), normalMap: tex('tile_n', { data: true, rx: 1 / 1.2, ry: 1 / 1.2 }), normalScale: new V2(.3, .3), roughness: .28, envMapIntensity: .9 }),
  skirting: std({ color: 0xf4f2ee, roughness: .45 }),
  oak: std({ map: tex('wood', { rx: 1, ry: 1 }), normalMap: tex('wood_n', { data: true }), normalScale: new V2(.3, .3), color: 0xe7cfa8, roughness: .55 }),
  walnut: std({ map: tex('wood', { rx: 1, ry: 1 }), color: 0x8a6446, roughness: .5 }),
  tread: std({ map: tex('wood', { rx: 1.5, ry: 1.5 }), color: 0xcfa878, roughness: .45, envMapIntensity: .8 }),
  whiteLac: std({ color: 0xf3f1ec, roughness: .38 }),
  whiteMatte: std({ color: 0xefede8, roughness: .75 }),
  front: std({ color: 0xf1efea, roughness: .55 }),
  counter: std({ map: tex('quartz', { rx: .8, ry: .8 }), color: 0xf2f0ec, roughness: .25, envMapIntensity: 1 }),
  sofa: std({ map: tex('fabric', { rx: 2.5, ry: 2.5 }), normalMap: tex('fabric_n', { data: true, rx: 2.5, ry: 2.5 }), normalScale: new V2(.5, .5), color: 0xb3aa9c, roughness: .95 }),
  sofaDark: std({ map: tex('fabric', { rx: 2.5, ry: 2.5 }), normalMap: tex('fabric_n', { data: true, rx: 2.5, ry: 2.5 }), color: 0x6f7a74, roughness: .95 }),
  linen: std({ map: tex('fabric', { rx: 3, ry: 3 }), color: 0xf2efe8, roughness: .95 }),
  blanket: std({ map: tex('fabric', { rx: 3, ry: 3 }), normalMap: tex('fabric_n', { data: true, rx: 3, ry: 3 }), color: 0x7d8b7f, roughness: 1 }),
  curtain: std({ map: tex('fabric', { rx: 2, ry: 2 }), color: 0xe7e1d4, roughness: 1, side: THREE.DoubleSide }),
  rug: std({ map: tex('fabric', { rx: 4, ry: 4 }), normalMap: tex('fabric_n', { data: true, rx: 4, ry: 4 }), color: 0xcfc6b6, roughness: 1 }),
  metal: std({ color: 0x232426, roughness: .45, metalness: .6 }),
  steel: std({ color: 0xc4c7ca, roughness: .32, metalness: .9, envMapIntensity: 1.2 }),
  chrome: std({ color: 0xe8eaec, roughness: .12, metalness: 1, envMapIntensity: 1.3 }),
  ceramic: std({ color: 0xf6f6f4, roughness: .12, envMapIntensity: 1.1 }),
  blackGlass: std({ color: 0x0c0d0e, roughness: .08, metalness: .2, envMapIntensity: 1.2 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xeaf3f6, roughness: .04, metalness: 0, transparent: true, opacity: .14, envMapIntensity: 1, depthWrite: false }),
  showerGlass: new THREE.MeshPhysicalMaterial({ color: 0xdfeef0, roughness: .05, transparent: true, opacity: .22, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide }),
  pvc: std({ color: 0xf6f6f3, roughness: .35 }),
  doorLeaf: std({ color: 0xf2f0eb, roughness: .4 }),
  entryDoor: std({ color: 0x3a3632, roughness: .5, metalness: .35 }),
  fireclad: std({ map: tex('stone2', { rx: .9, ry: .9 }), normalMap: tex('stone2_n', { data: true, rx: .9, ry: .9 }), normalScale: new V2(.35, .35), color: 0xf4f0ea, roughness: .85 }),
  cement: std({ map: tex('cement', { rx: .7, ry: .7 }), color: 0xffffff, roughness: .8 }),
  firestone: std({ map: tex('firestone', { rx: 1.4, ry: 1.4 }), color: 0xf2eee8, roughness: .9 }),
  soot: std({ color: 0x141312, roughness: 1 }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }),
  lampShade: std({ color: 0xf5efe2, roughness: .9, emissive: 0x000000, side: THREE.DoubleSide }),
  lampEmit: new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xfff1d6, emissiveIntensity: .25, roughness: .8 }),
  plant: std({ color: 0x4f6b3c, roughness: .8, side: THREE.DoubleSide }),
  pot: std({ color: 0xd9d3c9, roughness: .8 }),
  book: [0x7a4b3a, 0x3f5a6b, 0xc8b88a, 0x5c6b4a, 0x8e8a86].map(c => std({ color: c, roughness: .8 })),
  siding: std({ map: tex('lining', { rx: 1 / 1.4, ry: 1 / 1.4, rot: Math.PI / 2 }), normalMap: tex('lining_n', { data: true, rx: 1 / 1.4, ry: 1 / 1.4, rot: Math.PI / 2 }), color: 0xd9c3a2, roughness: .8 }),
  plinth: std({ map: tex('firestone', { rx: 1.2, ry: 1.2 }), color: 0x8f8a84, roughness: .95 }),
  lawn: std({ map: tex('lawn', { rx: 40, ry: 40 }), color: 0xb7c49f, roughness: 1, envMapIntensity: .4 }),
  paving: std({ map: tex('paving', { rx: 1, ry: 1 }), color: 0xd8d4cc, roughness: .9 }),
  fence: std({ map: tex('wood', { rx: .3, ry: 1 }), color: 0x9a7a5a, roughness: .85 }),
  bark: std({ color: 0x5a4b3e, roughness: 1 })
};
MAT.lampEmit.userData.env = 1; ALL_MATS.push(MAT.lampEmit, MAT.glass, MAT.showerGlass);

/* ---------- утилиты геометрии ---------- */
const root = new THREE.Group(); scene.add(root);
const G = { interior: new THREE.Group(), ceiling: new THREE.Group(), exterior: new THREE.Group(), trees: new THREE.Group(), fx: new THREE.Group() };
Object.values(G).forEach(g => root.add(g));
function add(mesh, group = G.interior, cast = true, recv = true) { if(mesh.material===MAT.furn)furnitureUV(mesh);mesh.castShadow = cast; mesh.receiveShadow = recv; group.add(mesh); return mesh; }
// прямоугольный брус по плану: x0..x1, y0..y1 (план, см), h0..h1 (высота, см)
function B(mat, x0, y0, x1, y1, h0, h1, group, cast = true) {
  const w = Math.abs(x1 - x0) * S, d = Math.abs(y1 - y0) * S, h = (h1 - h0) * S;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(WX((x0 + x1) / 2), (h0 + h1) / 2 * S, WZ((y0 + y1) / 2));
  return add(m, group, cast);
}
function roundedRect(w, h, r) {
  const s = new THREE.Shape(); r = Math.max(0, Math.min(r, w * .49, h * .49));
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
// мягкий брус со скруглёнными рёбрами (подушки, матрас, столешницы)
function RB(mat, x0, y0, x1, y1, h0, h1, r = 3, group) {
  const w = Math.abs(x1 - x0) * S, d = Math.abs(y1 - y0) * S, h = (h1 - h0) * S;
  const bev = Math.max(.000005, Math.min(r * S, d * .49, w * .49, h * .49));
  const g = new THREE.ExtrudeGeometry(roundedRect(Math.max(.00001, w - 2 * bev), Math.max(.00001, h - 2 * bev), bev * .3),
    { depth: Math.max(.00001, d - 2 * bev), bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 3, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * bev) / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(WX((x0 + x1) / 2), (h0 + h1) / 2 * S, WZ((y0 + y1) / 2));
  return add(m, group);
}
function CYL(mat, cx, cy, r, h0, h1, seg = 24, group, r2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry((r2 ?? r) * S, r * S, (h1 - h0) * S, seg), mat);
  m.position.set(WX(cx), (h0 + h1) / 2 * S, WZ(cy));
  return add(m, group);
}
// alphaMap samples GREEN, not the alpha channel. Opaque grayscale masks
// avoid the white-to-transparent canvas turning into a solid rectangle.
function shadowMask(width,height,sample){
  const data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,v=Math.round(255*Math.max(0,Math.min(1,sample(x/(width-1),y/(height-1)))));
    data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.generateMipmaps=false;texture.flipY=false;texture.needsUpdate=true;
  return texture;
}
const blobTex=shadowMask(128,128,(u,v)=>{
  const r2=(2*u-1)**2+(2*v-1)**2;
  return Math.max(0,1-r2)**2.2;
});
const BLOB_MATS=new Map();
function blob(x0,y0,x1,y1,op=.45,h=.12,group=G.interior){
  if(!BLOB_MATS.has(op))BLOB_MATS.set(op,new THREE.MeshBasicMaterial({color:0x000000,alphaMap:blobTex,transparent:true,opacity:op,depthWrite:false}));
  const m=new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1-x0)*S*1.25,Math.abs(y1-y0)*S*1.25),BLOB_MATS.get(op));
  m.rotation.x=-Math.PI/2;m.position.set(WX((x0+x1)/2),h*S,WZ((y0+y1)/2));m.renderOrder=1;
  m.userData.blob=true;group.add(m);return m;
}
// With flipY=false the wall-facing edge of these planes is v=1.
const aoTex=shadowMask(4,128,(u,v)=>v**2.6);
const aoFloorMat=new THREE.MeshBasicMaterial({color:0x000000,alphaMap:aoTex,transparent:true,opacity:.18,depthWrite:false});
const aoCeilMat=new THREE.MeshBasicMaterial({color:0x000000,alphaMap:aoTex,transparent:true,opacity:.08,depthWrite:false});


/* ---------- стены ---------- */
// проём: type door|arch|window|open; s,e — от начала стены (см); sill/head — высоты
function wallShape(Ht, ops, u0, u1) {
  const m = v => v * S, s = new THREE.Shape();
  const fl = ops.filter(o => o.type !== 'window' && o.e > u0 && o.s < u1).sort((a, b) => a.s - b.s);
  s.moveTo(0, 0);
  for (const o of fl) {
    const a = Math.max(o.s, u0) - u0, b = Math.min(o.e, u1) - u0;
    if (a > 0) s.lineTo(m(a), 0);
    if (o.type === 'arch') {
      s.lineTo(m(a), m(o.spring));
      const cx = (a + b) / 2, hw = (b - a) / 2;
      for (let i = 1; i <= 20; i++) { const t = Math.PI * (1 - i / 20); s.lineTo(m(cx + Math.cos(t) * hw), m(o.spring + Math.sin(t) * o.rise)); }
    } else { s.lineTo(m(a), m(Math.min(o.head, Ht))); s.lineTo(m(b), m(Math.min(o.head, Ht))); }
    s.lineTo(m(b), 0);
  }
  s.lineTo(m(u1 - u0), 0); s.lineTo(m(u1 - u0), m(Ht)); s.lineTo(0, m(Ht)); s.lineTo(0, 0);
  for (const o of ops.filter(o => o.type === 'window' && o.s >= u0 - .1 && o.e <= u1 + .1 && o.head <= Ht)) {
    const h = new THREE.Path(), a = o.s - u0, b = o.e - u0;
    h.moveTo(m(a), m(o.sill)); h.lineTo(m(a), m(o.head)); h.lineTo(m(b), m(o.head)); h.lineTo(m(b), m(o.sill)); h.lineTo(m(a), m(o.sill));
    s.holes.push(h);
  }
  return s;
}
const WALLS = [];
function wall(a, b, t, ops = [], o = {}) {
  const w = { a, b, t, ops, H: o.H || HC, inSide: o.inSide, sides: o.sides || [1, -1], range: o.range, ext: o.ext, name: o.name };
  w.dx = b[0] - a[0]; w.dy = b[1] - a[1]; w.L = Math.hypot(w.dx, w.dy); w.th = Math.atan2(w.dy, w.dx);
  w.dir = [w.dx / w.L, w.dy / w.L]; w.nrm = [-w.dir[1], w.dir[0]];   // нормаль стороны +1 в плане
  WALLS.push(w); return w;
}
// точка на грани стены: вдоль u (см), сторона side, отступ off (см) от грани, в плановых координатах
function wp(w, u, side, off = 0) { const k = side * (w.t / 2 + off); return [w.a[0] + w.dir[0] * u + w.nrm[0] * k, w.a[1] + w.dir[1] * u + w.nrm[1] * k]; }
function placeOnWall(obj, w, u, side, off, y) {
  const p = wp(w, u, side, off); obj.position.set(WX(p[0]), y * S, WZ(p[1])); obj.rotation.y = -w.th; return obj;
}
function buildWall(w, mat = MAT.wall) {
  const g = new THREE.ExtrudeGeometry(wallShape(w.H, w.ops, 0, w.L), { depth: w.t * S, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -w.t * S / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(WX(w.a[0]), 0, WZ(w.a[1])); m.rotation.y = -w.th;
  add(m, G.interior); w.mesh = m; return m;
}
// облицовка грани стены (обои, плитка, сайдинг) с вырезами проёмов
function overlay(w, side, u0, u1, mat, Ht = w.H, group = G.interior, off = .25) {
  const g = new THREE.ShapeGeometry(wallShape(Ht, w.ops, u0, u1));
  const m = new THREE.Mesh(g, mat);
  if (side < 0) { m.material = mat; }
  const p = wp(w, u0, side, off);
  m.position.set(WX(p[0]), 0, WZ(p[1])); m.rotation.y = -w.th;
  if (side < 0) { m.scale.z = -1; }
  mat.side = THREE.DoubleSide;
  m.receiveShadow = true; group.add(m); return m;
}
function floorOpenings(w) { return w.ops.filter(o => o.type !== 'window').map(o => [o.s, o.e]).sort((a, b) => a[0] - b[0]); }
function subtract(u0, u1, holes) { const out = []; let c = u0; for (const [a, b] of holes) { if (b <= c || a >= u1) continue; if (a > c) out.push([c, a]); c = Math.max(c, b); } if (c < u1) out.push([c, u1]); return out; }
// плинтус и полосы затенения вдоль граней
function trimWall(w) {
  for (const side of w.sides) {
    const [r0, r1] = (w.range && w.range[side]) || [0, w.L];
    for (const [a, b] of subtract(r0, r1, floorOpenings(w))) {
      const len = (b - a) * S; if (len < .03) continue;
      if (!w.noSkirt) {
        const sk = new THREE.Mesh(new THREE.BoxGeometry(len, .07, .014), MAT.skirting);
        placeOnWall(sk, w, (a + b) / 2, side, .7, 3.5); add(sk, G.interior, false, true);
      }
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, .14), aoFloorMat);
      f.rotation.set(-Math.PI / 2, 0, 0); const grp = new THREE.Group(); grp.add(f);
      f.position.set(0, 0, 0); f.rotation.x = -Math.PI / 2;
      // ориентируем: градиент от стены в комнату
      const p = wp(w, (a + b) / 2, side, 7);
      grp.position.set(WX(p[0]), .003, WZ(p[1])); grp.rotation.y = -w.th + (side > 0 ? 0 : Math.PI);
      G.interior.add(grp); f.renderOrder = 1;
    }
    const [c0, c1] = (w.range && w.range[side]) || [0, w.L];
    const len = (c1 - c0) * S;
    const cf = new THREE.Mesh(new THREE.PlaneGeometry(len, .12), aoCeilMat); cf.rotation.x = Math.PI / 2;
    const cg = new THREE.Group(); cg.add(cf);
    const p = wp(w, (c0 + c1) / 2, side, 6);
    cg.position.set(WX(p[0]), w.H * S - .003, WZ(p[1])); cg.rotation.y = -w.th + (side > 0 ? Math.PI : 0);
    G.ceiling.add(cg);
  }
}
/* ---------- открывающиеся двери и дверцы ---------- */
const TOG = [];
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function hinge(obj, axis, openRad, startOpen = false, label = '') {
  const t = { obj, axis, open: openRad, cur: startOpen ? 1 : 0, target: startOpen ? 1 : 0, label, base: axis === 'px' ? obj.position.x : axis === 'pz' ? obj.position.z : 0 };
  obj.traverse(o => { o.userData.tog = t; }); TOG.push(t); applyTog(t); return t;
}
function applyTog(t) { const a = t.open * ease(t.cur); if (t.axis === 'y') t.obj.rotation.y = a; else if (t.axis === 'x') t.obj.rotation.x = a; else if (t.axis === 'px') t.obj.position.x = t.base + a; else if (t.axis === 'pz') t.obj.position.z = t.base + a; else if (t.axis === 'fn') t.fn(ease(t.cur)); }

// Cabinet leaves stop before masonry or door casings, including handle depth.
function cabinetHinge(obj,openRad,startOpen,label){
  const t=hinge(obj,'y',openRad,startOpen,label);t.kind='cabinet';t.requestedOpen=openRad;return t;
}
const CABINET_OBSTACLES=[];
function buildCabinetObstacles(){
  CABINET_OBSTACLES.length=0;
  for(const w of WALLS){
    const cuts=[...new Set([0,w.L,...w.ops.flatMap(o=>[o.s,o.e])])].sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){
      const a=cuts[i],b=cuts[i+1],mid=(a+b)/2;
      const opening=w.ops.find(o=>mid>o.s&&mid<o.e);
      const heights=opening?(opening.type==='window'?[[0,opening.sill],[opening.head,w.H]]:[[opening.head,w.H]]):[[0,w.H]];
      for(const [h0,h1] of heights){
        if(h1<=h0)continue;
        const corners=[wp(w,a,1),wp(w,a,-1),wp(w,b,1),wp(w,b,-1)];
        const box=new THREE.Box3(new V3(WX(Math.min(...corners.map(p=>p[0]))),h0*S,WZ(Math.min(...corners.map(p=>p[1])))),new V3(WX(Math.max(...corners.map(p=>p[0]))),h1*S,WZ(Math.max(...corners.map(p=>p[1])))));
        CABINET_OBSTACLES.push({box,name:w.name});
      }
    }
  }
  scene.updateMatrixWorld(true);
  G.interior.traverse(o=>{if(o.isMesh&&o.userData.role==='door-casing')CABINET_OBSTACLES.push({box:new THREE.Box3().setFromObject(o),name:'наличник'});});
}
function cabinetLeafLocalBounds(t){
  const old=t.obj.rotation.y;t.obj.rotation.y=0;t.obj.updateWorldMatrix(true,true);
  const inverse=t.obj.matrixWorld.clone().invert(),out=new THREE.Box3(),v=new V3();
  t.obj.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();const b=o.geometry.boundingBox,m=inverse.clone().multiply(o.matrixWorld);
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])out.expandByPoint(v.set(x,y,z).applyMatrix4(m));
  });
  t.obj.rotation.y=old;t.obj.updateWorldMatrix(true,true);return out;
}
function cabinetSweep(t,angle){
  const matrix=t.obj.parent.matrixWorld.clone().multiply(new THREE.Matrix4().compose(t.obj.position,new THREE.Quaternion().setFromAxisAngle(new V3(0,1,0),angle),t.obj.scale));
  const b=t.closedBounds,poly=[[b.min.x,b.min.z],[b.max.x,b.min.z],[b.max.x,b.max.z],[b.min.x,b.max.z]].map(p=>new V3(p[0],0,p[1]).applyMatrix4(matrix));
  const lo=new V3(0,b.min.y,0).applyMatrix4(matrix).y,hi=new V3(0,b.max.y,0).applyMatrix4(matrix).y;
  return{poly,lo,hi};
}
function cabinetHitsWall(t,angle,clearance=.002){
  const {poly,lo,hi}=cabinetSweep(t,angle);
  const axes=[[1,0],[0,1],[poly[1].z-poly[0].z,poly[0].x-poly[1].x],[poly[2].z-poly[1].z,poly[1].x-poly[2].x]];
  for(const obstacle of CABINET_OBSTACLES){
    const b=obstacle.box;
    if(hi<=b.min.y||lo>=b.max.y)continue;
    const rect=[[b.min.x-clearance,b.min.z-clearance],[b.max.x+clearance,b.min.z-clearance],[b.max.x+clearance,b.max.z+clearance],[b.min.x-clearance,b.max.z+clearance]];
    let separated=false;
    for(const [ax,az]of axes){
      const p=poly.map(v=>v.x*ax+v.z*az),q=rect.map(v=>v[0]*ax+v[1]*az);
      if(Math.max(...p)<=Math.min(...q)||Math.max(...q)<=Math.min(...p)){separated=true;break;}
    }
    if(!separated)return obstacle.name;
  }
  return null;
}
function limitCabinetOpenings(){
  buildCabinetObstacles();
  for(const t of TOG.filter(t=>t.kind==='cabinet')){
    t.closedBounds=cabinetLeafLocalBounds(t);
    const requested=Math.abs(t.requestedOpen),sign=Math.sign(t.requestedOpen),step=THREE.MathUtils.degToRad(.5);
    let safe=0,blocked=null;
    for(let a=0;a<=requested+step/2;a+=step){
      const angle=Math.min(requested,a),hit=cabinetHitsWall(t,sign*angle);
      if(hit){blocked=hit;break;}safe=angle;
    }
    // A further half-degree keeps the moving outer edge away from the stop.
    t.open=sign*(blocked?Math.max(0,safe-step):requested);t.wallStop=blocked;
    t.obj.traverse(o=>{o.userData.tog=t;});applyTog(t);
  }
  invalidateShadows();
}

/* ---------- корпусная мебель с полками и дверцами ----------
   Локальная система: u — вдоль фасада (см), z — глубина, фасад на z = D, y — высота. */
function cabinet(ox, oy, rot, W, D, h0, h1, o = {}) {
  const grp = new THREE.Group(); grp.position.set(WX(ox), h0 * S, WZ(oy)); grp.rotation.y = rot; G.interior.add(grp);
  const T = 1.8, Hh = h1 - h0, body = o.body || MAT.whiteMatte, inner = o.inner || body;
  const box = (u0, y0, z0, u1, y1, z1, mat, parent = grp) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(u1 - u0) * S, Math.abs(y1 - y0) * S, Math.abs(z1 - z0) * S), mat);
    if(mat===MAT.furn) furnitureUV(m);
    m.position.set((u0 + u1) / 2 * S, (y0 + y1) / 2 * S, (z0 + z1) / 2 * S); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  const Dc = D - (o.frontT ?? 1.8);                           // глубина корпуса без фасада
  const plinth = o.plinth || 0;
  box(0, 0, 0, T, Hh, Dc, body); box(W - T, 0, 0, W, Hh, Dc, body);           // боковины
  box(T, plinth, 0, W - T, plinth + T, Dc, inner); box(T, Hh - T, 0, W - T, Hh, Dc, body);   // дно, крышка
  box(T, plinth, 0, W - T, Hh, .8, inner);                                       // задняя стенка
  if (plinth) box(T, 0, 0, W - T, plinth, Dc - 4, MAT.metal);
  for (const u of o.parts || []) box(u - T / 2, plinth, 0, u + T / 2, Hh - T, Dc - .2, inner);   // перегородки
  for (const [a, b, y] of o.shelves || []) box(a + .1, y, 1, b - .1, y + T, Dc - 1, inner);
  for (const [a, b, y] of o.rods || []) { const r = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, (b - a) * S, 10), MAT.chrome); r.rotation.z = Math.PI / 2; r.position.set((a + b) / 2 * S, y * S, Dc / 2 * S); grp.add(r); }
  if (o.fill) o.fill(box, grp);
  // дверцы
  for (const d of o.doors || []) {
    const pv = new THREE.Group(); grp.add(pv);
    const mat = d.mat || MAT.front, ft = o.frontT ?? 1.8, gap = .25;
    const y0 = d.y0 ?? plinth, y1 = d.y1 ?? Hh;
    let panel;
    if (d.type === 'L' || d.type === 'R') {
      const w = d.u1 - d.u0 - 2 * gap, hu = d.type === 'L' ? d.u0 + gap : d.u1 - gap, sg = d.type === 'L' ? 1 : -1;
      pv.position.set(hu * S, 0, D * S);
      panel = box(0, y0 + gap, -ft, sg * w, y1 - gap, 0, mat, pv);
      if (d.inner) d.inner(box, pv, sg, w);
      if (d.handle !== false) { const hx = sg * (w - 4); const hy = d.hy ?? (d.handleTop ? y0 + 12 : (y1 - (o.upper ? 8 : 12))); const hv = d.hv ?? !!d.tall;
        if (hv) box(hx - .6, hy - 20, 0, hx + .6, hy + 20, 2.4, MAT.steel, pv); else box(hx - .6, hy - .6, 0, hx + .6, hy + .6, 2.2, MAT.steel, pv).scale.set(1, 1, 1);
        if (!hv) box(sg > 0 ? hx - 14 : hx - 1, hy - .6, 2, sg > 0 ? hx + 1 : hx + 14, hy + .6, 2.6, MAT.steel, pv); }
      cabinetHinge(pv,(d.type==='L'?-1:1)*(d.angle??100)*Math.PI/180,!!d.startOpen,d.label);
    } else if (d.type === 'S') {
      // купе: две направляющие, створка уезжает за соседнюю
      const tr = d.track || 0, fh = ft / 2, zA = D - fh * (tr + 1), zB = D - fh * tr, w = d.u1 - d.u0;
      pv.position.set(d.u0 * S, 0, 0);
      panel = box(0, y0 + gap, zA, w, y1 - gap, zB - .1, mat, pv);
      box(0, y0 + gap, zB - .1, 1.6, y1 - gap, zB + .2, MAT.steel, pv); box(w - 1.6, y0 + gap, zB - .1, w, y1 - gap, zB + .2, MAT.steel, pv);
      box(0, y1 - 3, zB - .1, w, y1 - gap, zB + .2, MAT.steel, pv); box(0, y0 + gap, zB - .1, w, y0 + 3, zB + .2, MAT.steel, pv);
      if (d.mirror) box(10, y0 + 30, zB - .05, w - 10, y1 - 30, zB + .05, MAT.chrome, pv);
      hinge(pv, 'px', d.slide * S, !!d.startOpen, d.label);
    } else if (d.type === 'drawer') {
      const w = d.u1 - d.u0;
      pv.position.set(d.u0 * S, 0, D * S);
      panel = box(gap, y0 + gap, -ft, w - gap, y1 - gap, 0, mat, pv);
      const dy0 = y0 + 3, dy1 = y1 - 4;
      box(3, dy0, -(D - 6), w - 3, dy0 + 1, -ft, MAT.whiteMatte, pv); box(3, dy0, -(D - 6), 4.2, dy1, -ft, MAT.whiteMatte, pv); box(w - 4.2, dy0, -(D - 6), w - 3, dy1, -ft, MAT.whiteMatte, pv); box(3, dy0, -(D - 6), w - 3, dy1, -(D - 7.2), MAT.whiteMatte, pv);
      if (d.fill) d.fill(box, pv);
      const hy = (y0 + y1) / 2 + 4; box(w / 2 - 9, hy - .7, 0, w / 2 + 9, hy + .7, 2.4, MAT.steel, pv);
      hinge(pv, 'pz', (d.pull ?? 42) * S, !!d.startOpen, d.label);
    } else {
      const down = d.type === 'down';
      pv.position.set(d.u0 * S, (down ? y0 : y1) * S, D * S);
      panel = box(gap, down ? gap : -(y1 - y0) + gap, -ft, d.u1 - d.u0 - gap, down ? (y1 - y0) - gap : -gap, 0, mat, pv);
      if (d.inner) d.inner(box, pv);
      if (d.handle !== false) { const hy = down ? (y1 - y0) - 5 : -(y1 - y0) + 6; box(8, hy - .7, 0, d.u1 - d.u0 - 8, hy + .7, 2.6, MAT.steel, pv); }
      hinge(pv, 'x', (down ? 1 : -1) * (d.angle ?? (down ? 85 : 95)) * Math.PI / 180, !!d.startOpen, d.label);
    }
    if (panel && !mat.transparent) {
      const old=panel.geometry,p=old.parameters;
      panel.geometry=rboxL(p.width,p.height,p.depth,.0018,mat).geometry;if(mat===MAT.furn)furnitureUV(panel);old.dispose();
    }
    if (d.front) d.front(box, pv, panel);
  }
  return grp;
}

/* ---------- живой огонь, телевизоры ---------- */
const FIRE = { power: 1, t: 0 };
FIRE.mat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { time: { value: 0 }, power: { value: 1 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform float time,power;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
  void main(){vec2 uv=vUv;float t=time;
    float q=fbm(vec2(uv.x*4.,uv.y*3.-t*1.9));float r=fbm(vec2(uv.x*7.+q,uv.y*5.-t*2.8));
    float base=0.;for(int k=0;k<4;k++){float cx=.18+float(k)*.21+sin(t*1.3+float(k)*2.1)*.02;base=max(base,1.-abs(uv.x-cx)*5.5);}
    float f=base*1.25-uv.y*1.35+r*.85-.15;f=clamp(f,0.,1.);
    vec3 c=mix(vec3(.9,.18,.02),vec3(1.,.62,.14),smoothstep(.1,.55,f));c=mix(c,vec3(1.,.86,.55),smoothstep(.75,1.,f));
    float a=smoothstep(.05,.45,f)*power*smoothstep(0.,.08,uv.y);
    gl_FragColor=vec4(c*a*1.05,a);}`
});
MAT.ember = new THREE.MeshStandardMaterial({ color: 0x2a0c02, emissive: 0xff4a10, emissiveIntensity: 1.2, roughness: 1 });
const TVS = [];
// UV в метрах для бруса, чтобы текстура не растягивалась
function boxUV(m) {
  const p = m.geometry.parameters, uv = m.geometry.attributes.uv, dims = [[p.depth, p.height], [p.depth, p.height], [p.width, p.depth], [p.width, p.depth], [p.width, p.height], [p.width, p.height]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
  uv.needsUpdate = true; return m;
}
const tvTex = tex('tv');
function tv(x, y, facing, w, h, h0) {
  // facing 'y+' — экран смотрит в сторону +y плана; 'x-' — в сторону −x
  const grp = new THREE.Group(); const d = 3.5;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), MAT.metal); grp.add(body);
  const scrM = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: .12, metalness: .1, emissive: 0xffffff, emissiveMap: tvTex, emissiveIntensity: 0, envMapIntensity: 1.1 });
  ALL_MATS.push(scrM); scrM.userData.env = 1.1;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry((w - 2) * S, (h - 2) * S), scrM); scr.position.z = d / 2 * S + .001; grp.add(scr);
  grp.position.set(WX(x), (h0 + h / 2) * S, WZ(y) + (facing === 'y+' ? d / 2 * S : 0));
  if (facing === 'x-') { grp.rotation.y = -Math.PI / 2; grp.position.x -= d / 2 * S; }
  grp.traverse(o => { o.castShadow = true; }); G.interior.add(grp);
  const glow = new THREE.PointLight(0x9fb8ff, 0, 3.5, 2); glow.position.set(0, 0, .6); grp.add(glow);
  const t = { obj: grp, axis: 'fn', open: 1, cur: 0, target: 0, label: 'Телевизор', fn: v => { scrM.emissiveIntensity = v * 1.1; scrM.color.setScalar(.02 + v * .1); glow.intensity = v * .35; } };
  grp.traverse(o => o.userData.tog = t); TOG.push(t); return t;
}

/* ---------- окна: ПВХ-рама, импост, стекло, подоконник, отлив ---------- */
function windowUnit(w, o, inSide, opts = {}) {
  const grp = new THREE.Group(); const len = (o.e - o.s), hgt = o.head - o.sill;
  const fr = 6.5, dep = 7;                      // профиль, см
  const mk = (x0, y0, x1, y1, z0, z1, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) * S, Math.abs(y1 - y0) * S, Math.max(.2, Math.abs(z1 - z0)) * S), mat);
    m.position.set((x0 + x1) / 2 * S, (y0 + y1) / 2 * S, (z0 + z1) / 2 * S); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
  // рама в плоскости стены чуть ближе к улице
  const zc = -inSide * (w.t / 2 - 8);            // локальная z (сторона +1 = +z)
  const z0 = zc - dep / 2, z1 = zc + dep / 2;
  mk(0, 0, len, fr, z0, z1, MAT.pvc); mk(0, hgt - fr, len, hgt, z0, z1, MAT.pvc);
  mk(0, 0, fr, hgt, z0, z1, MAT.pvc); mk(len - fr, 0, len, hgt, z0, z1, MAT.pvc);
  const nMul = len > 125 ? 1 : 0;
  if (nMul) mk(len / 2 - 3, 0, len / 2 + 3, hgt, z0, z1, MAT.pvc);
  if (opts.transom) mk(0, hgt - 42, len, hgt - 36, z0, z1, MAT.pvc);
  // створки: тонкая рамка вокруг стекла
  const panes = nMul ? [[fr, len / 2 - 3], [len / 2 + 3, len - fr]] : [[fr, len - fr]];
  for (const [a, b] of panes) {
    mk(a, fr, b, fr + 4, z0 + 1, z1 - 1, MAT.pvc); mk(a, hgt - fr - 4, b, hgt - fr, z0 + 1, z1 - 1, MAT.pvc);
    mk(a, fr, a + 4, hgt - fr, z0 + 1, z1 - 1, MAT.pvc); mk(b - 4, fr, b, hgt - fr, z0 + 1, z1 - 1, MAT.pvc);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry((b - a - 8) * S, (hgt - 2 * fr - 8) * S), MAT.glass);
    gl.position.set((a + b) / 2 * S, hgt / 2 * S, zc * S); gl.renderOrder = 3; grp.add(gl);
    // ручка
    const hd = mk(b - 9, hgt / 2 - 6, b - 7, hgt / 2 + 6, zc + inSide * dep / 2, zc + inSide * (dep / 2 + 3), MAT.pvc);
  }
  // подоконник (внутри) и отлив (снаружи)
  const zfi = inSide > 0 ? z1 : z0, zi = inSide * (w.t / 2 + 5);
  if (!opts.noSill) { const sill=mk(-6, -2.5, len + 6, .6, Math.min(zfi, zi), Math.max(zfi, zi), opts.sillMat || MAT.whiteLac);sill.name='window-sill';sill.userData.role='window-sill';furnitureUV(sill); }
  const zfo = inSide > 0 ? z0 : z1, ze = -inSide * (w.t / 2 + 4);
  mk(-3, -2, len + 3, .4, Math.min(zfo, ze), Math.max(zfo, ze), MAT.metal);
  const p = wp(w, o.s, 0, 0); grp.position.set(WX(p[0]), o.sill * S, WZ(p[1])); grp.rotation.y = -w.th;
  G.interior.add(grp); return grp;
}

/* ---------- двери: наличники, полотна ---------- */
function casing(w, o, sides) {
  for (const side of sides) {
    const mk = (u, len, hgt, y, width) => { const m = new THREE.Mesh(new THREE.BoxGeometry(width * S, hgt * S, 1.6 * S), MAT.doorLeaf);
      placeOnWall(m, w, u, side, .8, y);m.userData.role='door-casing';add(m,G.interior,false,true); };
    mk(o.s - 3.5, 0, o.head + 7, (o.head + 7) / 2, 7); mk(o.e + 3.5, 0, o.head + 7, (o.head + 7) / 2, 7);
    const t = new THREE.Mesh(new THREE.BoxGeometry((o.e - o.s + 14) * S, 7 * S, 1.6 * S), MAT.doorLeaf); placeOnWall(t, w, (o.s + o.e) / 2, side, .8, o.head + 3.5); add(t, G.interior, false, true);
  }
}
function leaf(w, o, hingeSide, swingSide, angleDeg, mat = MAT.doorLeaf, style = 'plain', startOpen = true) {
  const width = o.e - o.s - 5, hgt = o.head - 2, th = 4;
  const pivot = new THREE.Group();
  const hu = hingeSide === 's' ? o.s + 2.5 : o.e - 2.5;
  const p = wp(w, hu, swingSide, -w.t / 2 + th / 2 + (swingSide * 0));   // ось по центру стены, со стороны открывания
  const pc = wp(w, hu, swingSide, -th / 2);
  pivot.position.set(WX(pc[0]), 0, WZ(pc[1])); pivot.rotation.y = -w.th;
  const g = new THREE.Group(); pivot.add(g);
  const dirU = hingeSide === 's' ? 1 : -1;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width * S, hgt * S, th * S), mat);
  body.position.set(dirU * width / 2 * S, hgt / 2 * S + .01, 0); body.castShadow = body.receiveShadow = true; g.add(body);
  if (style === 'glass') {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry((width - 24) * S, 90 * S), MAT.glass); gl.position.set(dirU * width / 2 * S, 1.45, th / 2 * S + .001); g.add(gl);
    const gl2 = gl.clone(); gl2.position.z = -th / 2 * S - .001; g.add(gl2);
  }
  if (style === 'panel') {
    for (const [y0, y1] of [[20, 95], [110, 190]]) for (const sd of [1, -1]) {
      const pn = new THREE.Mesh(new THREE.BoxGeometry((width - 26) * S, (y1 - y0) * S, .6 * S), mat); pn.position.set(dirU * width / 2 * S, (y0 + y1) / 2 * S, sd * (th / 2 + .3) * S); g.add(pn);
    }
  }
  for (const sd of [1, -1]) {
    const hnd = new THREE.Mesh(new THREE.BoxGeometry(13 * S, 1.6 * S, 1.6 * S), style === 'entry' ? MAT.steel : MAT.metal);
    hnd.position.set(dirU * (width - 8) * S + (-dirU) * 5 * S, 1.02, sd * (th / 2 + 4) * S); g.add(hnd);
    const ros = new THREE.Mesh(new THREE.CylinderGeometry(2.5 * S, 2.5 * S, 1 * S, 16), style === 'entry' ? MAT.steel : MAT.metal); ros.rotation.x = Math.PI / 2;
    ros.position.set(dirU * (width - 8) * S, 1.02, sd * (th / 2 + .5) * S); g.add(ros);
  }
  const t=hinge(g,'y',dirU*swingSide*-angleDeg*Math.PI/180,startOpen,'Дверь · '+w.name);t.kind='door';t.wallName=w.name;
  G.interior.add(pivot); return pivot;
}
// комнатное растение: горшок, грунт, стебли и листья
const leafGeo = (() => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(.05, .09, 0, .2); sh.quadraticCurveTo(-.05, .09, 0, 0); const g = new THREE.ShapeGeometry(sh, 6);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setZ(i, -y * y * 1.2 + Math.abs(x) * .4); } g.computeVertexNormals(); return g; })();
const leafMats = [0x3f5e33, 0x4d6e3b, 0x5b7c44].map(c => std({ color: c, roughness: .7, side: THREE.DoubleSide }));
function plant(x, y, k = 1, base = 0) {
  CYL(MAT.pot, x, y, 15 * k, base, base + 34 * k, 24, G.interior, 12 * k);
  CYL(MAT.soot, x, y, 13.8 * k, base + 31 * k, base + 32 * k, 20);
  const grp = new THREE.Group(); grp.position.set(WX(x), (base + 32 * k) * S, WZ(y)); G.interior.add(grp);
  let seed = x * 13 + y * 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const stems = Math.round(7 + 5 * k);
  for (let i = 0; i < stems; i++) {
    const a = rnd() * Math.PI * 2, tilt = .15 + rnd() * .5, len = (.45 + rnd() * .55) * k;
    const top = new V3(Math.sin(a) * Math.sin(tilt) * len, Math.cos(tilt) * len, Math.cos(a) * Math.sin(tilt) * len);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(.005, .007, len, 5), MAT.bark); st.position.copy(top).multiplyScalar(.5);
    st.quaternion.setFromUnitVectors(new V3(0, 1, 0), top.clone().normalize()); grp.add(st);
    const nl = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < nl; j++) {
      const t = .45 + j / nl * .6, lf = new THREE.Mesh(leafGeo, leafMats[(i + j) % 3]);
      lf.position.copy(top).multiplyScalar(Math.min(1, t)); lf.scale.setScalar((.9 + rnd() * .6) * k);
      lf.rotation.set(-.4 - rnd() * .9, a + (j % 2 ? 1.6 : -1.6) + rnd() * .6, rnd() * .6 - .3, 'YXZ'); lf.castShadow = true; grp.add(lf);
    }
  }
  blob(x - 18 * k, y - 18 * k, x + 18 * k, y + 18 * k, .3);
}

/* ---------- дополнительные материалы ---------- */
MAT.leather = std({ color: 0x1f1d1c, roughness: .42, envMapIntensity: .9 });
MAT.furn = std({ map: tex('wood', { rx: 1, ry: 1 }), normalMap: tex('wood_n', { data: true }), normalScale: new V2(.25, .25), color: 0x8a6446, roughness: .42, envMapIntensity: .9 });
MAT.leatherInlay = std({ color: 0x2a2826, roughness: .5 });
MAT.screen = new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: .15, emissive: 0xffffff, emissiveMap: tex('screen'), emissiveIntensity: .55 }); ALL_MATS.push(MAT.screen);
MAT.cabGlass = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ea, roughness: .05, transparent: true, opacity: .22, envMapIntensity: 1, depthWrite: false }); ALL_MATS.push(MAT.cabGlass);
MAT.accent = std({ color: 0xf1ede5, roughness: .9, normalMap: plasterN, normalScale: new V2(.1, .1), side: THREE.DoubleSide });
MAT.corridorWall = std({ color: 0xe9e7e2, roughness: .9 });
MAT.flagWhite = std({ color: 0xf4f4f2, roughness: .9, side: THREE.DoubleSide });
// Microstructure maps are deterministic and remain fully offline.
function microMap(kind, size = 256) {
  const data = new Uint8Array(size * size * 4); let seed = 72631;
  const rnd = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v;
    if (kind === 'leather') v = 139 + 22 * Math.sin(x * .82 + Math.sin(y * .63)) * Math.sin(y * .73 + Math.sin(x * .32)) + (rnd() - .5) * 35;
    else if (kind === 'weave') v = 153 + 30 * Math.sin(x * Math.PI / 2) + 23 * Math.sin(y * Math.PI / 2) + (rnd() - .5) * 12;
    else v = 181 + (rnd() - .5) * 35;
    const i = (y * size + x) * 4; data[i] = data[i+1] = data[i+2] = v; data[i+3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = Math.min(maxAniso, 8);
  t.repeat.set(kind === 'leather' ? 10 : 6, kind === 'leather' ? 10 : 6); t.needsUpdate = true; return t;
}
const leatherMicro = microMap('leather'), weaveMicro = microMap('weave'), paintMicro = microMap('paint');
MAT.leather.bumpMap = leatherMicro; MAT.leather.bumpScale = .0015;
MAT.leather.roughnessMap = leatherMicro; MAT.leather.roughness = .82;
MAT.leatherInlay.bumpMap = leatherMicro; MAT.leatherInlay.bumpScale = .0007; MAT.leatherInlay.roughness = .83;
MAT.sofaDark.normalScale.set(.15, .15); MAT.sofaDark.bumpMap = weaveMicro; MAT.sofaDark.bumpScale = .0013;
MAT.furn.normalScale.set(.10, .10); MAT.furn.roughness = .62;
MAT.wall.normalScale.set(.055, .055); MAT.wall.bumpMap = paintMicro; MAT.wall.bumpScale = .00035;
MAT.counter.roughness = .48; MAT.tile.roughness = .62; MAT.tileWall.roughness = .57;
MAT.oakFloor.normalScale.set(.19, .19); MAT.rug.normalScale.set(.17, .17);
MAT.chrome.roughness = .25; MAT.steel.roughness = .39;
MAT.seam = std({color:0x746c61, roughness:1});
MAT.meshBack = std({color:0x49514e, map:tex('fabric',{rx:6,ry:6}), bumpMap:weaveMicro, bumpScale:.002, roughness:.92, side:THREE.DoubleSide});
MAT.blind = std({color:0xe1ddd2, map:tex('fabric',{rx:3,ry:3}), roughness:1, side:THREE.DoubleSide});
MAT.shadowGap = std({color:0x393c39, roughness:.86});
MAT.brass = std({color:0xb1a17d, metalness:.75, roughness:.42});

// Uniform, metre-scaled UVs on cabinet boards. End grain no longer stretches.
function furnitureUV(mesh) {
  const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
  if(!p||!n||!uv)return;
  g.computeBoundingBox();const size=g.boundingBox.getSize(new V3()),tall=size.y>size.x&&size.y>size.z;
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));
    let u,v;
    if(ny>=nx&&ny>=nz){u=size.z>size.x?z:x;v=size.z>size.x?x:z;}
    else if(nx>nz){u=tall?y:z;v=tall?z:y;}
    else{u=tall?y:x;v=tall?x:y;}
    uv.setXY(i,u,v);
  }
  uv.needsUpdate=true;
}

const WIN = (s, e, sill = 80, head = 262) => ({ type: 'window', s, e, sill, head });
const DOOR = (s, e, head = 215) => ({ type: 'door', s, e, head });

/* ---------- полы и потолки ---------- */
function planShape(pts, holes = [], flip = true) {
  const s = new THREE.Shape(pts.map(([x, y]) => new V2(WX(x), flip ? -WZ(y) : WZ(y))));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new V2(WX(x), flip ? -WZ(y) : WZ(y)))));
  return s;
}
function floorPoly(pts, mat, y = 0, group = G.interior) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(planShape(pts)), mat); m.rotation.x = -Math.PI / 2; m.position.y = y * S; m.receiveShadow = true; group.add(m); return m;
}

/* ---------- реестры проекта ---------- */
// Предметы с идентификатором: из них строятся план, ведомость, столкновения и проверки.
const PROJECT_ITEMS = [];
let CURRENT_ITEM = null;
function fit(id, room, label, rect, fn, collision = true) {
  const before = new Set(G.interior.children), item = { id, room, label, rect, objects: [], collision, plan: [] };
  const prev = CURRENT_ITEM; CURRENT_ITEM = item;
  let result; try { result = fn(); } finally { CURRENT_ITEM = prev; }
  item.objects = G.interior.children.filter(o => !before.has(o));
  for (const o of item.objects) { o.userData.itemId = id; o.userData.room = room; }
  PROJECT_ITEMS.push(item); return result;
}
// Условные знаки плана: круг, эллипс, линии, тёмная заливка. Привязываются к текущему предмету или к декору.
const PLAN_SYMBOLS = [];
function planSymbol(sym) { if (CURRENT_ITEM) CURRENT_ITEM.plan.push(sym); else PLAN_SYMBOLS.push(sym); return sym; }
// Дополнительные контуры столкновений: круги и повёрнутые прямоугольники.
const COLLIDERS = { circles: [], oriented: [], rects: [] };
const BLINDS = [];

/* ---------- светильники ---------- */

const LAMPS=[];
function beam(x,y,z,kind,color,angle=.88,shadow=false){
  const L=new THREE.SpotLight(color,0,kind==='task'?2.2:5.2,angle,.65,2);
  L.position.set(WX(x),z,WZ(y));L.target.position.set(WX(x),0,WZ(y));scene.add(L,L.target);
  L.castShadow=shadow;L.shadow.mapSize.set(1024,1024);L.shadow.bias=-.00015;L.shadow.normalBias=.015;
  L.shadow.camera.near=.08;L.shadow.camera.far=5.5;
  LAMPS.push({L,kind});return L;
}
function panelLamp(x,y,w=60,d=60){
  const suspended=w>100,top=suspended?267:299;
  B(MAT.whiteMatte,x-w/2-1,y-d/2-1,x+w/2+1,y+d/2+1,top-3,top+1,G.ceiling,false);
  B(MAT.lampEmit,x-w/2,y-d/2,x+w/2,y+d/2,top-3.15,top-3,G.ceiling,false);
  if(suspended)for(const a of [-1,1])CYL(MAT.steel,x+a*w*.38,y,.12,top+1,300,6,G.ceiling);
  beam(x,y,(top-5)*S,'panel',0xf9f1df,1.0,true);
}
function downLight(x,y,shadow=false){
  CYL(MAT.whiteMatte,x,y,7,298.5,300,24,G.ceiling).castShadow=false;
  CYL(MAT.shadowGap,x,y,5.6,298.3,298.5,24,G.ceiling).castShadow=false;
  CYL(MAT.lampEmit,x,y,4.8,298.2,298.3,24,G.ceiling).castShadow=false;
  beam(x,y,2.965,'down',0xf9f1df,.82,shadow);
}
