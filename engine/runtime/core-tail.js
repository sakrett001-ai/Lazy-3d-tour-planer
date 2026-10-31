
/* ================== СБОРКА ПРОЕКТА ИЗ ДАННЫХ ================== */
const WALL_BY_ID = {};
for (const d of PROJECT.walls) {
  const w = wall(d.a, d.b, d.t, (d.ops || []).map(o => ({ ...o })), { sides: d.sides, range: d.range, name: d.id, H: d.H });
  if (d.noSkirt) w.noSkirt = true; w.def = d; WALL_BY_ID[d.id] = w;
}
function wallOf(id) { const w = WALL_BY_ID[id]; if (!w) throw new Error('Неизвестная стена: ' + id); return w; }
WALLS.forEach(w => { buildWall(w, matByName(w.def.mat, MAT.wall)); trimWall(w); });
for (const o of PROJECT.overlays || []) overlay(wallOf(o.wall), o.side, o.u[0], o.u[1], matByName(o.mat), o.H ?? undefined);

let floorMain = null;
for (const f of PROJECT.floors || []) { const m = floorPoly(f.poly, matByName(f.mat), f.y ?? 0); if (f.main && !floorMain) floorMain = m; }
for (const c of PROJECT.ceilings || []) {
  const ceil = new THREE.Mesh(new THREE.ShapeGeometry(planShape(c.poly, [], false)), matByName(c.mat, MAT.ceiling));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = (c.h ?? HC) * S; ceil.castShadow = true; G.ceiling.add(ceil);
}

// окна и рулонные шторы — по настройке стены
for (const w of WALLS) {
  const cfg = w.def.windows; if (!cfg) continue;
  const inSide = cfg.inSide ?? 1;
  for (const o of w.ops.filter(o => o.type === 'window')) {
    windowUnit(w, o, inSide, { transom: !!cfg.transom, noSill: !!cfg.noSill, sillMat: matByName(cfg.sill) });
    const bl = cfg.blinds; if (!bl) continue;
    const a = o.s + (bl.inset ?? 0), b = o.e - (bl.inset ?? 0), len = b - a, mid = (a + b) / 2, over = bl.overhang ?? 3;
    const box = new THREE.Mesh(new THREE.BoxGeometry((len + 2 * over) * S, (bl.cassetteZ[1] - bl.cassetteZ[0]) * S, (bl.cassette[1] - bl.cassette[0]) * S), MAT.whiteMatte);
    placeOnWall(box, w, mid, inSide, (bl.cassette[0] + bl.cassette[1]) / 2, (bl.cassetteZ[0] + bl.cassetteZ[1]) / 2); add(box, G.interior, false);
    const blind = new THREE.Mesh(new THREE.PlaneGeometry(len * S, 1), MAT.blind);
    placeOnWall(blind, w, mid, inSide, bl.plane, (bl.top ?? 260) - 29);
    blind.scale.y = .58; blind.castShadow = true; blind.receiveShadow = true; blind.userData.top = (bl.top ?? 260) * S;
    G.interior.add(blind); BLINDS.push(blind);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len * S, .012, .012), MAT.whiteMatte); bar.position.set(0, -.5, .006); blind.add(bar);
  }
}
// двери: наличники и полотна
for (const d of PROJECT.doors || []) {
  const w = wallOf(d.wall), op = w.ops.filter(o => o.type === 'door')[d.op ?? 0];
  if (!op) throw new Error('Нет дверного проёма ' + (d.op ?? 0) + ' в стене ' + d.wall);
  if (d.casing !== false) casing(w, op, d.casing || [1, -1]);
  leaf(w, op, d.hinge || 's', d.swing ?? 1, d.angle ?? 90, matByName(d.mat, MAT.doorLeaf), d.style || 'plain', !!d.open);
}

// предметы: каталог, свои изделия проекта и примитивы
function buildPart(p) {
  const fn = CUSTOM[p.type] || CATALOG[p.type];
  if (!fn) throw new Error('Неизвестный тип изделия: ' + p.type);
  return fn(p);
}
function buildItem(it) {
  const base = { room: it.room, label: it.label };
  const run = () => { let r; if (it.parts) for (const p of it.parts) r = buildPart({ ...base, ...p }); else r = buildPart(it); return r; };
  if (!it.id) return run();
  const result = fit(it.id, it.room, it.label, it.rect || null, run, it.collision !== false);
  const entry = PROJECT_ITEMS[PROJECT_ITEMS.length - 1];
  entry.category = it.category || null; entry.type = it.type || (it.parts ? it.parts[0].type : null);
  return result;
}
(PROJECT.items || []).forEach((it, i) => { try { buildItem(it); } catch (e) { throw new Error(`items[${i}]${it.id ? ' (' + it.id + ')' : ''} ${it.type || (it.parts ? 'parts' : '')}: ${e.message}`); } });
(PROJECT.lights || []).forEach((l, i) => { try { buildPart(l); } catch (e) { throw new Error(`lights[${i}] ${l.type}: ${e.message}`); } });


// габариты проекта по стенам, см: [xmin, ymin, xmax, ymax]
const PROJECT_BOUNDS = (() => { const xs = [], ys = []; for (const w of WALLS) for (const p of [w.a, w.b]) { xs.push(p[0]); ys.push(p[1]); } return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; })();
const EXTENT_M = Math.max(PROJECT_BOUNDS[2] - PROJECT_BOUNDS[0], PROJECT_BOUNDS[3] - PROJECT_BOUNDS[1]) * S;

/* ================== ГОРОД ЗА ОКНАМИ ================== */
const EXT = PROJECT.exterior || { type: 'none' };
const GROUND = EXT.ground ?? -1050;                              // уровень земли относительно пола, см
if (EXT.type === 'city') (function city() {
  const E = G.exterior;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), std({ map: tex('lawn', { rx: 60, ry: 60 }), color: 0x9fae8c, roughness: 1, envMapIntensity: .3 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND * S; add(ground, E, false, true);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 12), std({ color: 0x4a4d52, roughness: .95 })); road.rotation.x = -Math.PI / 2; road.position.set(0, GROUND * S + .02, -22); add(road, E, false, true);
  // фасад самого здания вокруг офиса (видно в «Обзоре»)
  const fac = std({ color: 0xd9d3c7, roughness: .9 });
  const FB = EXT.facade || [PROJECT_BOUNDS[0] - 30, PROJECT_BOUNDS[1], PROJECT_BOUNDS[2] + 30, PROJECT_BOUNDS[3] + 30];
  B(fac, FB[0], FB[1], FB[2], FB[3], GROUND, -30, E, false);
  // соседние дома
  const FAC = { panel: [tex('facade_panel'), tex('facade_panel_night')], brick: [tex('facade_brick'), tex('facade_brick_night')], modern: [tex('facade_modern'), tex('facade_modern_night')] };
  window.FACADE_MATS = [];
  const house = (x, z, w, d, floors, kind) => {
    const h = floors * 3.2;
    const mk = (len) => { const t = FAC[kind][0].clone(), n = FAC[kind][1].clone(); for (const q of [t, n]) { q.wrapS = q.wrapT = THREE.RepeatWrapping; q.repeat.set(len / 36, floors / 5); q.needsUpdate = true; }
      const m = new THREE.MeshBasicMaterial({ map: t, color: 0xe6e8e3, fog: false }); m.userData.day = t; m.userData.night = n; FACADE_MATS.push(m); return m; };
    const roof = new THREE.MeshBasicMaterial({ color: 0x8e9090 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mk(d), mk(d), roof, roof, mk(w), mk(w)]); m.position.set(x, GROUND * S + h / 2, z); E.add(m);
  };
  house(-18, -48, 36, 14, 9, 'brick'); house(24, -52, 30, 14, 12, 'modern'); house(-58, -40, 22, 16, 7, 'panel'); house(60, -44, 22, 18, 9, 'panel');
  house(-4, -80, 60, 16, 16, 'modern'); house(-70, 10, 16, 40, 9, 'brick'); house(70, 12, 16, 40, 7, 'panel');
  // деревья вдоль улицы
  const tmap = tex('trees'); tmap.wrapS = tmap.wrapT = THREE.ClampToEdgeWrapping;
  const tMat = new THREE.MeshStandardMaterial({ map: tmap, alphaTest: .5, side: THREE.DoubleSide, roughness: 1, color: 0xdfe6d6 }); ALL_MATS.push(tMat); tMat.userData.env = .6;
  const geo = [0, 1, 2, 3].map(k => { const g = new THREE.PlaneGeometry(1, 1.5); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / 4); g.translate(0, .75, 0); return g; });
  for (let i = 0; i < 26; i++) { const x = -60 + i * 4.8 + (i % 3), z = -15 - (i % 2) * 14, k = [0, 1, 3, 0][i % 4], h = 9 + (i % 4) * 1.5;
    for (const r of [0, Math.PI / 2]) { const m = new THREE.Mesh(geo[k], tMat); m.scale.set(h * .7, h / 1.5, 1); m.position.set(x, GROUND * S, z); m.rotation.y = r + i; G.trees.add(m); } }
})();

/* ---------- небо ---------- */
const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: { dusk: { value: 0 } },
  vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform float dusk;varying vec3 vP;void main(){vec3 d=normalize(vP);float h=d.y;
    vec3 sunD=normalize(vec3(.55,.5,.66));float s=max(dot(d,sunD),0.);
    vec3 day=mix(vec3(.88,.91,.93),vec3(.36,.56,.82),smoothstep(-.02,.7,h));day+=vec3(1.,.93,.8)*(pow(s,8.)*.25+pow(s,200.)*.8);
    float west=pow(max(dot(normalize(vec3(d.x,0.,d.z)),normalize(vec3(-.6,0.,-.8))),0.),2.);
    vec3 eve=mix(mix(vec3(.3,.25,.33),vec3(.95,.46,.2),west),vec3(.09,.12,.28),smoothstep(0.,.3,h));eve=mix(eve,vec3(.012,.02,.06),smoothstep(.28,.9,h));
    vec3 c=mix(day,eve,dusk);gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`
}));
sky.renderOrder = -1; scene.add(sky);

/* ---------- освещение ---------- */
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.set(9, 8.5, 10.5); sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const SUN_HALF = Math.max(11, EXTENT_M / 2 + 4);
Object.assign(sun.shadow.camera, { left: -SUN_HALF, right: SUN_HALF, top: SUN_HALF, bottom: -SUN_HALF, near: 1, far: Math.max(40, SUN_HALF * 3.6) });
sun.shadow.bias = -0.00015; sun.shadow.normalBias = .012; sun.shadow.radius = 2;
renderer.shadowMap.autoUpdate = false;
const SHADOW_LIGHTS=[sun,...LAMPS.map(l=>l.L).filter(l=>l.castShadow)];
for(const light of SHADOW_LIGHTS)light.shadow.autoUpdate=false;
const SHADOW_OBJECT_BOUNDS=new WeakMap();
// Static maps survive camera motion. Only lights within reach of a changed
// object are invalidated; screens changing brightness do not move geometry.
function invalidateShadows(changed=null){
  let bounds=null;
  if(changed){
    const movers=changed.filter(t=>t.axis!=='fn'||t.affectsShadow);if(!movers.length)return;
    bounds=movers.map(t=>{
      const current=new THREE.Box3().setFromObject(t.obj),swept=current.clone();
      if(SHADOW_OBJECT_BOUNDS.has(t))swept.union(SHADOW_OBJECT_BOUNDS.get(t));
      SHADOW_OBJECT_BOUNDS.set(t,current);return swept;
    });
  }else{
    for(const t of TOG)if(t.axis!=='fn'||t.affectsShadow)SHADOW_OBJECT_BOUNDS.set(t,new THREE.Box3().setFromObject(t.obj));
  }
  let updated=false;
  for(const light of SHADOW_LIGHTS){
    if(!light.castShadow)continue;
    if(bounds&&!light.isDirectionalLight&&bounds.every(b=>b.distanceToPoint(light.position)>light.distance))continue;
    light.shadow.needsUpdate=true;updated=true;
  }
  if(updated)renderer.shadowMap.needsUpdate=true;
}

const hemi = new THREE.HemisphereLight(0xdfe9f2, 0x8a8070, .35); scene.add(hemi);
// окружение для PBR-отражений и мягкого заполняющего света
let ENV_TARGET=null,ENV_PRESET=null;
function refreshEnvironment(preset=PROJECT.planner?.lighting.preset) {
  if(PROJECT.planner&&ENV_PRESET===preset)return;
  const pm = new THREE.PMREMGenerator(renderer); const es = new THREE.Scene();
  if(PROJECT.planner){plannerEnvironment(es,preset);}else{
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 12), new THREE.MeshBasicMaterial({ color: 0x8c8983, side: THREE.BackSide })); room.position.y = 2; es.add(room);
  const flo = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x9c968c })); flo.rotation.x = -Math.PI / 2; flo.position.y = -.4; es.add(flo);
  for (const [x, z, w, h, r, c] of [[0, -5.9, 5, 2.2, 0, 3.2], [5.9, 0, 4, 2.2, -Math.PI / 2, 2.4], [0, 5.9, 5, 2.2, Math.PI, 1.8], [0, 4.4, 6, 6, 0, 1.2]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, .97).multiplyScalar(c) }));
    if (c === 1.2) { p.rotation.x = Math.PI / 2; p.position.set(0, 4.45, 0); } else { p.position.set(x, 1.6, z); p.rotation.y = r; }
    es.add(p);
  }
  }
  if(ENV_TARGET?.dispose)ENV_TARGET.dispose();
  ENV_TARGET=pm.fromScene(es,.08);scene.environment=ENV_TARGET.texture;ENV_PRESET=preset;
  pm.dispose();es.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
}
refreshEnvironment();

/* ---------- режимы освещения ---------- */
let lighting = 'day';
const LIGHT_MODES={
 day:{sun:[5,7,-11],sunC:0xfff1dd,sunI:2.2,hemiI:.40,hemiC:0xe1eaf0,hemiG:0xaca18d,dusk:0,bg:0xdfe6ea,env:.85,lamps:.32,exp:1.02,glass:[.08,0xf0f5f6]},
 work:{sun:[5,7,-11],sunC:0xf5f3ef,sunI:.65,hemiI:.46,hemiC:0xe8edf0,hemiG:0xa39c90,dusk:0,bg:0xdce3e7,env:.75,lamps:.85,exp:1.03,glass:[.08,0xf0f5f6]},
 sunset:{sun:[-9,2.6,-8],sunC:0xffba81,sunI:1.65,hemiI:.28,hemiC:0xffdfc1,hemiG:0x8d8174,dusk:.55,bg:0xe0b89a,env:.57,lamps:.70,exp:1.07,glass:[.12,0xf3e7d9]},
 evening:{sun:[5,7,-11],sunC:0xffe2bf,sunI:0,hemiI:.18,hemiC:0x8c98a9,hemiG:0x6c6258,dusk:1,bg:0x111b2a,env:.38,lamps:1,exp:1.12,glass:[.20,0x8c9ba9]}
};
const LAMP_BASE={panel:12,down:8,floor:2.0,task:2.2};
const LIGHT_NEXT={day:'work',work:'sunset',sunset:'evening',evening:'day'};

function setLighting(name) {
  if (!LIGHT_MODES[name]) name = 'day';
  lighting = name; const c = LIGHT_MODES[name];
  sun.position.set(...c.sun); sun.color.set(c.sunC); sun.intensity = c.sunI; sun.castShadow = c.sunI > 0;
  hemi.intensity = c.hemiI; hemi.color.set(c.hemiC); hemi.groundColor.set(c.hemiG);
  sky.material.uniforms.dusk.value = c.dusk; scene.background.set(mode === 'walk' ? c.bg : (name === 'evening' ? 0x1a1f28 : 0xe9e7e2));
  ALL_MATS.forEach(m => { if ('envMapIntensity' in m) m.envMapIntensity = (m.userData.env ?? 1) * c.env; });
  for(const l of LAMPS){l.L.intensity=(LAMP_BASE[l.kind]||2)*c.lamps;if(l.kind==='panel'||l.kind==='down')l.L.color.set(name==='work'?0xf5f3ed:name==='evening'?0xffe6c5:0xfff2df);}
  MAT.lampEmit.emissiveIntensity = .4 + 2.2 * c.lamps;
  MAT.lampShade.emissive.set(0xffb070); MAT.lampShade.emissiveIntensity = .5 * c.lamps;
  MAT.glass.opacity = c.glass[0]; MAT.glass.color.set(c.glass[1]);
  (window.FACADE_MATS || []).forEach(m => { const n = name === 'evening'; m.map = n ? m.userData.night : m.userData.day; m.color.set(n ? 0xffffff : name === 'sunset' ? 0xf0d0b8 : 0xe6e8e3); m.needsUpdate = true; });
  renderer.toneMappingExposure = c.exp;
  const lb = document.getElementById('lightBtn'); if (lb) lb.textContent = { day: '☀ День', work:'◉ Рабочий', sunset: '◐ Закат', evening: '☾ Вечер' }[name];
  if(PROJECT.planner)applyPlannerLighting(name);
  invalidateShadows(); dirty = true;
  state.lighting = name; saveState();
}

/* ---------- отделка ---------- */
const PALETTES = PROJECT.finishes?.palettes || {
  business:{name:'Деловой · светлый дуб',desc:'Тёплый серый, дуб и шалфей',swatches:['#e6e3db','#c6b295','#66716a','#454b49'],floor:'oak',walls:'greige',accent:'sage',wood:'oak',leather:'graphite'},
  classic:{name:'Классический · орех',desc:'Слоновая кость, орех и коньяк',swatches:['#ece7dc','#967553','#a4a096','#6c4c37'],floor:'oak',walls:'warm',accent:'wood',wood:'walnut',leather:'cognac'},
  nordic:{name:'Светлый · ясень',desc:'Жемчужный, ясень и серый текстиль',swatches:['#e4e7e4','#dbd3c3','#879594','#89908c'],floor:'ash',walls:'pearl',accent:'slate',wood:'ash',leather:'stone'},
  graphite:{name:'Строгий · графит',desc:'Светлые стены, дымчатый дуб и синий',swatches:['#e5e4e1','#9a9186','#536577','#3c4348'],floor:'carpet',walls:'grey',accent:'blue',wood:'smoked',leather:'graphite'},
  sand:{name:'Тёплый · песочный',desc:'Песок, натуральный дуб и глина',swatches:['#e6dece','#c6b295','#a28b77','#958c7e'],floor:'oak',walls:'beige',accent:'clay',wood:'oak',leather:'taupe'},
  olive:{name:'Спокойный · оливковый',desc:'Светлый камень, орех и олива',swatches:['#e7e3d9','#a18c72','#828777','#6a7366'],floor:'limestone',walls:'warm',accent:'sage',wood:'walnut',leather:'olive'}
};
const FIN = {
  lighting:{day:'Дневной',work:'Рабочий нейтральный',sunset:'Закат',evening:'Вечерний'},
  floor:{oak:'Натуральный дуб',ash:'Светлый дуб',walnut:'Тёмный орех',carpet:'Ковровая плитка',limestone:'Светлый известняк',stone:'Серый керамогранит'},
  walls:{warm:'Слоновая кость',greige:'Тёплый серый',pearl:'Жемчужный',grey:'Светло-серый',beige:'Песочный',sage:'Серо-зелёный'},
  accent:{paint:'В цвет стен',wood:'Панели из ореха',oak:'Панели из дуба',sage:'Шалфей',green:'Лесной зелёный',blue:'Приглушённый синий',slate:'Серо-голубой',clay:'Глина'},
  wood:{oak:'Натуральный дуб',walnut:'Орех',ash:'Светлый ясень',smoked:'Дымчатый дуб',wenge:'Венге',ivory:'Матовая слоновая кость'},
  leather:{graphite:'Графитовая кожа',black:'Чёрная кожа',cognac:'Коньячная кожа',taupe:'Кожа тауп',stone:'Серая ткань',olive:'Оливковая ткань'},
  blinds:{open:'Подняты',filter:'Мягкий дневной свет',private:'Прикрыты'},
  quality:{balanced:'Сбалансированное',high:'Высокая детализация'}
};
const COLORS={walls:{warm:0xeeeae1,greige:0xe6e3db,pearl:0xe4e7e4,grey:0xe5e4e1,beige:0xe6dece,sage:0xd9dfd5},wood:{oak:0xcfbb9e,walnut:0xa08466,ash:0xe2dcd0,smoked:0xa49c91,wenge:0x65594d,ivory:0xe9e5dd},leather:{graphite:0x454b49,black:0x262a29,cognac:0x79553b,taupe:0x958c7e,stone:0x89908c,olive:0x6a7366},accent:{sage:0x828d80,green:0x4f6253,blue:0x536577,slate:0x879594,clay:0xa28b77}};
const DEFAULT_PALETTE = PROJECT.finishes?.palette || Object.keys(PALETTES)[0];
const DEFAULTS={...PALETTES[DEFAULT_PALETTE],palette:DEFAULT_PALETTE,lighting:'day',blinds:'filter',quality:'balanced',...(PROJECT.finishes?.defaults||{})};
delete DEFAULTS.name;delete DEFAULTS.desc;delete DEFAULTS.swatches;
const state={...DEFAULTS};
const STORAGE_KEY=PROJECT.meta?.storageKey||('interior-tour-'+(PROJECT.meta?.id||'project'));
function saveState(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){}}
try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');for(const key of Object.keys(FIN))if(FIN[key][saved[key]])state[key]=saved[key];if(PALETTES[saved.palette]||saved.palette==='custom')state.palette=saved.palette;}catch(e){}
const carpetTex=tex('fabric',{rx:5,ry:5}),carpetN=tex('fabric_n',{data:true,rx:5,ry:5}),liningTex=tex('lining',{rx:1,ry:1}),liningN=tex('lining_n',{data:true});
const oakMap=MAT.oakFloor.map,oakN=MAT.oakFloor.normalMap,woodMap=MAT.furn.map,woodN=MAT.furn.normalMap;
const stoneMap=tex('cement',{rx:.7,ry:.7});
function setPalette(key){if(!PALETTES[key])return;const p=PALETTES[key];for(const k of ['floor','walls','accent','wood','leather'])state[k]=p[k];state.palette=key;applyFinish();buildPanel();}
function applyFinish(){
  const f=MAT.oakFloor;if(floorMain){floorMain.material=f;f.map=oakMap;f.normalMap=oakN;f.normalScale.set(.16,.16);f.roughness=.70;
  f.color.set({oak:0xe6dbc9,ash:0xf2eee5,walnut:0xb39a7d}[state.floor]||0xffffff);
  if(state.floor==='carpet'){f.map=carpetTex;f.normalMap=carpetN;f.normalScale.set(.2,.2);f.color.set(0x969b99);f.roughness=1;}
  if(state.floor==='limestone'){f.map=stoneMap;f.normalMap=plasterN;f.normalScale.set(.045,.045);f.color.set(0xded8ca);f.roughness=.82;}
  if(state.floor==='stone')floorMain.material=MAT.spc;
  }f.needsUpdate=true;MAT.wall.color.set(COLORS.walls[state.walls]);
  const a=MAT.accent;a.map=null;a.normalMap=plasterN;a.normalScale.set(.05,.05);a.roughness=.91;
  if(state.accent==='paint')a.color.copy(MAT.wall.color);
  else if(state.accent==='wood'||state.accent==='oak'){a.map=liningTex;a.normalMap=liningN;a.normalScale.set(.19,.19);a.color.set(state.accent==='wood'?0xa88c6a:0xdfcdb0);a.roughness=.69;}
  else a.color.set(COLORS.accent[state.accent]);a.needsUpdate=true;
  MAT.furn.map=state.wood==='ivory'?null:woodMap;MAT.furn.normalMap=state.wood==='ivory'?plasterN:woodN;MAT.furn.color.set(COLORS.wood[state.wood]);MAT.furn.roughness=state.wood==='ivory'?.78:.64;MAT.furn.needsUpdate=true;
  const fabric=state.leather==='stone'||state.leather==='olive';
  MAT.leather.map=fabric?carpetTex:null;MAT.leather.normalMap=fabric?carpetN:null;MAT.leather.normalScale.set(.12,.12);MAT.leather.bumpMap=fabric?weaveMicro:leatherMicro;MAT.leather.bumpScale=fabric?.0016:.0012;MAT.leather.roughnessMap=fabric?null:leatherMicro;MAT.leather.roughness=fabric?.97:.86;MAT.leather.color.set(COLORS.leather[state.leather]);MAT.leather.needsUpdate=true;
  MAT.sofaDark.color.set(COLORS.leather[state.leather]);MAT.meshBack.color.set(COLORS.leather[state.leather]);MAT.seam.color.set(COLORS.leather[state.leather]).lerp(new THREE.Color(0xb4ad9f),.3);
  MAT.rug.color.set(state.palette==='graphite'?0xa2a8a6:0xc5bfb1);
  const drop={open:.035,filter:.58,private:1.55}[state.blinds];
  for(const b of BLINDS){b.scale.y=drop;b.position.y=b.userData.top-drop/2;}
  const high=state.quality==='high';renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,high?2:1.5));
  const shadowSize=2048;if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}}
  for(const light of SHADOW_LIGHTS){
    if(!light.isSpotLight)continue;
    const size=high?1024:512;
    if(light.shadow.mapSize.x!==size){light.shadow.mapSize.set(size,size);if(light.shadow.map){light.shadow.map.dispose();light.shadow.map=null;}}
  }
  invalidateShadows();dirty=true;saveState();
}

// Static geometry keeps its exact world-space shape, UVs and material.
// Small spatial buckets retain useful frustum culling. Source meshes stay
// available for precise picking and model checks, but are not drawn twice.
const STATIC_BATCHES=[];
const RENDER_STATS={sourceMeshes:0,batchedMeshes:0,batches:0,savedSubmissions:0};
function isMovingMesh(mesh){
  for(let o=mesh;o;o=o.parent)if(o.userData.tog||BLINDS.includes(o))return true;
  return false;
}
function batchStaticGeometry(){
  scene.updateMatrixWorld(true);
  const center=new V3(),size=new V3();
  for(const root of [G.interior,G.ceiling]){
    const buckets=new Map(),inverse=root.matrixWorld.clone().invert();
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;RENDER_STATS.sourceMeshes++;
      if(!mesh.visible||mesh.isInstancedMesh||mesh.children.length||mesh===floorMain||isMovingMesh(mesh))return;
      const mat=mesh.material,g=mesh.geometry;
      if(Array.isArray(mat)||mat.transparent||mat.isShaderMaterial||mat.vertexColors||g.morphAttributes.position)return;
      if(!g.attributes.position||!g.attributes.normal||!g.attributes.uv||mesh.matrixWorld.determinant()<=0)return;
      if(g.drawRange.start!==0||g.drawRange.count!==Infinity)return;
      g.computeBoundingBox();const bounds=g.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      bounds.getSize(size);if(Math.max(size.x,size.y,size.z)>3.2)return;
      bounds.getCenter(center);
      const key=[mat.uuid,mesh.castShadow,mesh.receiveShadow,mesh.renderOrder,Math.floor(center.x/3),Math.floor(center.z/3)].join(':');
      if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);
    });
    for(const meshes of buckets.values()){
      if(meshes.length<2)continue;
      const count=meshes.reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count),0);
      const positions=new Float32Array(count*3),normals=new Float32Array(count*3),uvs=new Float32Array(count*2);
      const spans=[];let cursor=0;
      for(const source of meshes){
        const transformed=source.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,source.matrixWorld));
        const p=transformed.attributes.position,n=transformed.attributes.normal,uv=transformed.attributes.uv,index=transformed.index;
        const length=index?index.count:p.count;spans.push({source,start:cursor,count:length});
        for(let i=0;i<length;i++){
          const j=index?index.getX(i):i,k=cursor+i;
          positions.set([p.getX(j),p.getY(j),p.getZ(j)],k*3);
          normals.set([n.getX(j),n.getY(j),n.getZ(j)],k*3);
          uvs.set([uv.getX(j),uv.getY(j)],k*2);
        }
        cursor+=length;transformed.dispose();
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
      geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const batch=new THREE.Mesh(geometry,meshes[0].material);
      batch.name='static-batch';batch.castShadow=meshes[0].castShadow;batch.receiveShadow=meshes[0].receiveShadow;batch.renderOrder=meshes[0].renderOrder;
      batch.userData.batch=true;batch.matrixAutoUpdate=false;root.add(batch);
      STATIC_BATCHES.push({batch,spans});
      for(const mesh of meshes){mesh.visible=false;mesh.userData.batchSource=true;mesh.matrixAutoUpdate=false;}
      RENDER_STATS.batchedMeshes+=meshes.length;RENDER_STATS.batches++;
    }
  }
  RENDER_STATS.savedSubmissions=RENDER_STATS.batchedMeshes-RENDER_STATS.batches;
}

/* ---------- столкновения ---------- */
const SEGS = [];
for (const w of WALLS) for (const [a, b] of subtract(0, w.L, floorOpenings(w))) { const p = wp(w, a, 0), q2 = wp(w, b, 0); SEGS.push([p[0], p[1], q2[0], q2[1], w.t / 2]); }
function rectSeg(x0, y0, x1, y1) { SEGS.push([x0, y0, x1, y0, 2], [x1, y0, x1, y1, 2], [x1, y1, x0, y1, 2], [x0, y1, x0, y0, 2]); }
for(const item of PROJECT_ITEMS)if(item.collision&&item.rect)rectSeg(...item.rect);
for(const r of PROJECT.collisionRects||[])rectSeg(...r);
for(const r of COLLIDERS.rects)rectSeg(...r);
// Круглые предметы — многоугольником, а не описанным квадратом.
for(const c of COLLIDERS.circles)for(let i=0;i<c.n;i++){const a=i*Math.PI*2/c.n,b=(i+1)*Math.PI*2/c.n;SEGS.push([c.c[0]+c.r*Math.cos(a),c.c[1]+c.r*Math.sin(a),c.c[0]+c.r*Math.cos(b),c.c[1]+c.r*Math.sin(b),c.t]);}
for(const o of COLLIDERS.oriented){
  o.obj.updateWorldMatrix(true,false);
  const corners=o.corners.map(([x,z])=>new V3(x,0,z).applyMatrix4(o.obj.matrixWorld));
  for(let i=0;i<corners.length;i++){const a=corners[i],b=corners[(i+1)%corners.length];SEGS.push([(a.x+OX)*100,(a.z+OZ)*100,(b.x+OX)*100,(b.z+OZ)*100,o.t]);}
}

function dynamicSegments(){
 const out=[];for(const t of TOG){if(!t.closedBounds||t.axis!=='y')continue;t.obj.updateWorldMatrix(true,false);const b=t.closedBounds,poly=[[b.min.x,b.min.z],[b.max.x,b.min.z],[b.max.x,b.max.z],[b.min.x,b.max.z]].map(([x,z])=>new V3(x,0,z).applyMatrix4(t.obj.matrixWorld));for(let i=0;i<4;i++){const a=poly[i],b=poly[(i+1)%4];out.push([(a.x+OX)*100,(a.z+OZ)*100,(b.x+OX)*100,(b.z+OZ)*100,0]);}}return out;
}
function collide(p, R) {
  const segments=SEGS.concat(dynamicSegments());
  for (let it = 0; it < 3; it++) for (const [x0, y0, x1, y1, t] of segments) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy; let u = L2 ? ((p[0] - x0) * dx + (p[1] - y0) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
    const cx = x0 + dx * u, cy = y0 + dy * u; let ex = p[0] - cx, ey = p[1] - cy; const d = Math.hypot(ex, ey), need = R + t;
    if (d < need) { if (d < 1e-6) { ex = 1; ey = 0; } else { ex /= d; ey /= d; } p[0] = cx + ex * need; p[1] = cy + ey * need; }
  }
}
function floorAt() { return 0; }
const ROOMS = (PROJECT.rooms || []).map(r => ({ ...r, r: r.rect }));
function roomAt(x, y) { for (const r of ROOMS) if (!r.hidden && x >= r.r[0] && x <= r.r[2] && y >= r.r[1] && y <= r.r[3]) return r; return null; }
const START_ROOM = Math.max(0, ROOMS.findIndex(r => r.id === PROJECT.start));

/* ---------- камера и управление ---------- */
let mode = 'walk';
const walk = { x: 175, y: 612, yaw: 0, pitch: -.05, eyeY: 160 };
let eyeHeight=160;
const PLAN_DIST = PROJECT.camera?.planDist ?? Math.max(19, Math.round(EXTENT_M * 1.4)), ORBIT_DIST = PROJECT.camera?.orbitDist ?? Math.max(18, Math.round(EXTENT_M * 1.33)), PAN = Math.max(14, Math.ceil(EXTENT_M));
const orbit = { theta: .5, phi: .85, dist: ORBIT_DIST, tx: 0, ty: 0, tz: -.3 };
let viewLock = false;
const keys = {}; let joy = { x: 0, y: 0 };
function lookAtPlan(eye, look) { const p = [eye[0], eye[1]]; collide(p, 22); walk.x = p[0]; walk.y = p[1]; walk.yaw = Math.atan2(look[0] - eye[0], -(look[1] - eye[1])); walk.pitch = -.06; walk.eyeY = floorAt(eye[0], eye[1]) + eyeHeight; }
function setMode(m) {
  mode = m; document.body.dataset.mode = m;
  G.ceiling.visible = m === 'walk';
  G.trees.visible = m === 'walk'; G.exterior.visible = m === 'walk'; sky.visible = m === 'walk';
  scene.background.set(m === 'walk' ? LIGHT_MODES[lighting].bg : (lighting === 'evening' ? 0x1a1f28 : 0xe9e7e2));
  const asp = camera.aspect || 1;
  if (m === 'plan') { orbit.phi = .001; orbit.dist = asp < 1 ? PLAN_DIST * 15 / 19 / asp : PLAN_DIST; orbit.theta = 0; orbit.tx = 0; orbit.tz = -.2; camera.fov = 45; }
  else if (m === 'orbit') { if (orbit.phi < .2) { orbit.phi = .95; orbit.theta = .75; } orbit.dist = asp < 1 ? Math.min(40, ORBIT_DIST * 14 / 18 / asp) : ORBIT_DIST; camera.fov = 45; }
  else camera.fov = 62;
  camera.updateProjectionMatrix();
  document.querySelectorAll('[data-mode-btn]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modeBtn === m)));
  invalidateShadows(); dirty = true;
}
function updateCamera(dt) {
  if (viewLock) return;
  if (mode === 'walk') {
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (-joy.y);
    const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
    if (f || r) {
      const sp = (keys.ShiftLeft || keys.ShiftRight ? 280 : 150) * dt, sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
      const p = [walk.x + (sy * f + cy * r) * sp, walk.y + (-cy * f + sy * r) * sp];
      collide(p, 22); walk.x = p[0]; walk.y = p[1]; dirty = true;
    }
    const target = floorAt(walk.x, walk.y) + eyeHeight; walk.eyeY += (target - walk.eyeY) * Math.min(1, dt * 8);
    if (Math.abs(target - walk.eyeY) > .2) dirty = true;
    camera.up.set(0, 1, 0); camera.position.set(WX(walk.x), walk.eyeY * S, WZ(walk.y));
    const cp = Math.cos(walk.pitch);
    camera.lookAt(camera.position.x + Math.sin(walk.yaw) * cp, camera.position.y + Math.sin(walk.pitch), camera.position.z - Math.cos(walk.yaw) * cp);
  } else {
    const t = new V3(orbit.tx, orbit.ty, orbit.tz);
    camera.position.set(t.x + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta), t.y + orbit.dist * Math.cos(orbit.phi), t.z + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta));
    camera.up.set(0, 1, 0); if (orbit.phi < .01) camera.up.set(-Math.sin(orbit.theta), 0, -Math.cos(orbit.theta));
    camera.lookAt(t);
  }
}
// указатель: вращение взгляда / орбиты, щипок — масштаб
const ptrs = new Map(); let lastPinch = 0;
const cv = renderer.domElement; cv.style.touchAction = 'none';
let tapStart = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); hideHelpHint();
  tapStart = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
const ray = new THREE.Raycaster(), ndc = new V2();
const PICK_STATIC=[],PICK_MOVING=[],PICK_HITS=[],PICK_BROAD=[],PICK_POINT=new V3();
function buildPickIndex(){
  scene.updateMatrixWorld(true);
  G.interior.traverse(mesh=>{
    if(!mesh.isMesh||mesh.userData.batch||(!mesh.visible&&!mesh.userData.batchSource))return;
    if(mesh.material.transparent||mesh.material===aoFloorMat)return;
    if(mesh.isInstancedMesh)mesh.computeBoundingBox();
    else if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const entry={mesh,box:new THREE.Box3(),distance:0};
    entry.box.copy(mesh.isInstancedMesh?mesh.boundingBox:mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    (isMovingMesh(mesh)?PICK_MOVING:PICK_STATIC).push(entry);
  });
}
function castPickRay(){
  PICK_BROAD.length=0;PICK_HITS.length=0;
  for(const entry of PICK_MOVING){
    const mesh=entry.mesh;mesh.updateWorldMatrix(true,false);
    entry.box.copy(mesh.isInstancedMesh?mesh.boundingBox:mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
  }
  for(const entries of [PICK_STATIC,PICK_MOVING])for(const entry of entries){
    if(!entry.mesh.visible&&!entry.mesh.userData.batchSource)continue;
    const inside=entry.box.containsPoint(ray.ray.origin);
    if(!inside&&!ray.ray.intersectBox(entry.box,PICK_POINT))continue;
    entry.distance=inside?0:ray.ray.origin.distanceTo(PICK_POINT);
    if(entry.distance<=ray.far)PICK_BROAD.push(entry);
  }
  PICK_BROAD.sort((a,b)=>a.distance-b.distance);
  let nearest=null;
  for(const entry of PICK_BROAD){
    if(nearest&&entry.distance>nearest.distance)break;
    PICK_HITS.length=0;entry.mesh.raycast(ray,PICK_HITS);
    for(const hit of PICK_HITS)if(!nearest||hit.distance<nearest.distance)nearest=hit;
  }
  return nearest?nearest.object.userData.tog||null:null;
}
function pickToggle(cx,cy){
  const r=cv.getBoundingClientRect();ndc.set((cx-r.left)/r.width*2-1,-(cy-r.top)/r.height*2+1);
  camera.updateMatrixWorld();ray.setFromCamera(ndc,camera);ray.far=mode==='walk'?6:60;
  return castPickRay();
}

function toggleAt(cx, cy) { const t = pickToggle(cx, cy); if (!t) return false; t.target = t.target > .5 ? 0 : 1; dirty = true; return true; }
let hoverT = 0;
cv.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || e.buttons) return; const now = performance.now(); if (now - hoverT < 120) return; hoverT = now; cv.style.cursor = pickToggle(e.clientX, e.clientY) ? 'pointer' : ''; });
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastPinch && mode !== 'walk') { orbit.dist = Math.max(5, Math.min(Math.max(40, PLAN_DIST * 2), orbit.dist * lastPinch / d)); }
    lastPinch = d; dirty = true; return;
  }
  if (mode === 'walk') { walk.yaw += dx * .0048; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - dy * .0042)); }
  else if (p.b === 2 || e.shiftKey || mode === 'plan') {
    const k = orbit.dist * .0016, c = Math.cos(orbit.theta), sn = Math.sin(orbit.theta);
    orbit.tx -= c * dx * k; orbit.tz -= -sn * dx * k;
    orbit.tx += -sn * dy * k; orbit.tz += -c * dy * k;
    orbit.tx = Math.max(-PAN, Math.min(PAN, orbit.tx)); orbit.tz = Math.max(-PAN, Math.min(PAN + 2, orbit.tz));
  } else { orbit.theta -= dx * .006; orbit.phi = Math.max(.12, Math.min(1.45, orbit.phi - dy * .005)); }
  dirty = true;
});
const endPtr = e => { if (e.type === 'pointerup' && tapStart && ptrs.size === 1 && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 7 && performance.now() - tapStart.t < 450) toggleAt(e.clientX, e.clientY); tapStart = null; ptrs.delete(e.pointerId); if (ptrs.size < 2) lastPinch = 0; };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { e.preventDefault(); if (mode === 'walk') { camera.fov = Math.max(40, Math.min(85, camera.fov + e.deltaY * .03)); camera.updateProjectionMatrix(); } else orbit.dist = Math.max(5, Math.min(Math.max(40, PLAN_DIST * 2), orbit.dist * (1 + e.deltaY * .001))); dirty = true; }, { passive: false });
addEventListener('keydown', e => { if (e.target.closest && e.target.closest('input,select,textarea')) return; keys[e.code] = true; if (e.code === 'KeyL') { setLighting(LIGHT_NEXT[lighting]); buildPanel(); } });
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// джойстик для сенсорных экранов
(function joystick() {
  const pad = document.getElementById('joy'), knob = pad.querySelector('i'); let id = null, cx = 0, cy = 0;
  pad.addEventListener('pointerdown', e => { id = e.pointerId; pad.setPointerCapture(id); const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e); hideHelpHint(); });
  const move = e => { if (e.pointerId !== id) return; let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy), m = 44; if (d > m) { dx *= m / d; dy *= m / d; } knob.style.transform = `translate(${dx}px,${dy}px)`; joy = { x: dx / m, y: dy / m }; };
  pad.addEventListener('pointermove', move);
  const end = e => { if (e.pointerId !== id) return; id = null; joy = { x: 0, y: 0 }; knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
})();

/* ---------- интерфейс ---------- */
const $ = id => document.getElementById(id);
function hideHelpHint() { $('hint').classList.add('gone'); }
document.querySelectorAll('[data-mode-btn]').forEach(b => b.onclick = () => setMode(b.dataset.modeBtn));
const chips = $('rooms');
ROOMS.filter(r => !r.hidden || r.quick).forEach(r => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = r.name; b.onclick = () => { viewLock=false;eyeHeight=r.eyeHeight||160;lookAtPlan(r.eye, r.look);setMode('walk');hideHelpHint();dirty=true; }; chips.appendChild(b); r.btn = b; });
function buildPanel(){
  const body=$('panelBody');const openSections=[...body.querySelectorAll('details[open]')].map(d=>d.dataset.section);body.innerHTML='';
  const lead=document.createElement('p');lead.className='panel-intro';lead.textContent='Выберите готовое сочетание или настройте материалы отдельно.';body.appendChild(lead);
  const grid=document.createElement('div');grid.className='palette-grid';
  for(const [key,p] of Object.entries(PALETTES)){
    const b=document.createElement('button');b.className='palette';b.setAttribute('aria-pressed',String(state.palette===key));b.setAttribute('aria-label',p.name);
    b.innerHTML='<span class="swatches">'+p.swatches.map(c=>'<i style="background:'+c+'"></i>').join('')+'</span><b>'+p.name+'</b><small>'+p.desc+'</small>';
    b.onclick=()=>setPalette(key);grid.appendChild(b);
  }body.appendChild(grid);
  const selected=document.createElement('p');selected.className='selected-palette';selected.textContent=state.palette==='custom'?'Индивидуальное сочетание':PALETTES[state.palette].desc;body.appendChild(selected);
  const groups=[['lighting','Освещение'],['blinds','Рулонные шторы'],['floor','Пол'],['walls','Стены'],['accent','Акцентная стена'],['wood','Корпусная мебель'],['leather','Обивка'],['quality','Качество изображения']];
  for(const [key,title] of groups){
    const sec=document.createElement('details');sec.dataset.section=key;sec.open=openSections.includes(key)||key==='lighting';
    const summary=document.createElement('summary');summary.innerHTML=title+'<span>'+FIN[key][state[key]]+'</span>';sec.appendChild(summary);
    const options=document.createElement('div');options.className='option-grid';
    for(const [val,label] of Object.entries(FIN[key])){
      const b=document.createElement('button');b.className='opt';b.textContent=label;b.setAttribute('aria-pressed',String(state[key]===val));
      b.onclick=()=>{if(key==='lighting')setLighting(val);else{state[key]=val;if(['floor','walls','accent','wood','leather'].includes(key))state.palette='custom';applyFinish();}buildPanel();};options.appendChild(b);
    }sec.appendChild(options);body.appendChild(sec);
  }
  const reset=document.createElement('button');reset.className='reset-btn';reset.textContent='Вернуть базовый интерьер';reset.onclick=()=>{Object.assign(state,DEFAULTS);applyFinish();setLighting(state.lighting);buildPanel();};body.appendChild(reset);
  const note=document.createElement('p');note.className='note';note.textContent=PROJECT.finishes?.note||'Настройки сохраняются в этом браузере.';body.appendChild(note);
}

$('panelBtn').onclick = () => { const p = $('panel'); p.hidden = !p.hidden; $('panelBtn').setAttribute('aria-expanded', String(!p.hidden)); };
$('panelClose').onclick = () => { $('panel').hidden = true; $('panelBtn').setAttribute('aria-expanded', 'false'); };
$('lightBtn').onclick = () => { setLighting(LIGHT_NEXT[lighting]); buildPanel(); };
$('helpBtn').onclick = () => { $('help').hidden = false; };
$('helpGo').onclick = () => { $('help').hidden = true; };

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
  if (mode === 'walk') camera.fov = w < h ? 76 : 62;
  camera.updateProjectionMatrix(); dirty = true;
}
new ResizeObserver(resize).observe(stage);

/* ---------- цикл ---------- */
let last = performance.now(), fireT = 0, lastRoom = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const moving = mode === 'walk' && (joy.x || joy.y || Object.values(keys).some(Boolean));
  if (moving) dirty = true;
  const changed=[];
  for (const t of TOG) if (t.cur !== t.target) { changed.push(t); t.cur += Math.sign(t.target - t.cur) * dt / .55; if ((t.target - t.cur) * Math.sign(t.target - t.cur + 1e-9) <= 0 || Math.abs(t.target - t.cur) < .002) t.cur = t.target; t.cur = Math.max(0, Math.min(1, t.cur)); applyTog(t); dirty = true; }
  const animating = TOG.some(t => t.cur !== t.target);
  if (!dirty) return;
  updateCamera(dt);
  const r = mode === 'walk' ? roomAt(walk.x, walk.y) : null;
  if (r !== lastRoom) { lastRoom = r; $('roomName').textContent = r ? r.name : (mode === 'plan' ? 'План' : 'Обзор офиса'); ROOMS.forEach(q => q.btn && q.btn.setAttribute('aria-pressed', String(q === r))); }
  if(changed.length)invalidateShadows(changed);
  renderer.render(scene, camera);
  dirty = moving || animating;
}
// мелкие предметы не отбрасывают тень солнца — меньше нагрузка на телефонах
G.interior.traverse(o => { if (o.isMesh) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const sc = Math.max(o.scale.x, o.scale.y, o.scale.z); if (o.geometry.boundingSphere.radius * sc < .12) o.castShadow = false; } });
limitCabinetOpenings();
for(const t of TOG)if(t.kind==='door')t.closedBounds=cabinetLeafLocalBounds(t);
if(PROJECT.planner)buildPlannerRelief();
batchStaticGeometry();buildPickIndex();
buildPanel(); applyFinish();
eyeHeight = ROOMS[START_ROOM]?.eyeHeight || 160; lookAtPlan(ROOMS[START_ROOM].eye, ROOMS[START_ROOM].look);
setMode('walk'); setLighting(state.lighting || 'day'); resize();
requestAnimationFrame(frame);
if (!Object.keys(TEX).length) manager.onLoad();
// GLB подгружаются асинхронно: тени, выбор нажатием и мелкие тени — после загрузки каждой модели.
function onGlbLoaded(holder) {
  holder.traverse(o => { if (!o.isMesh) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z) < .12) o.castShadow = false;
    o.geometry.computeBoundingBox(); const entry = { mesh: o, box: o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld), distance: 0 }; PICK_STATIC.push(entry); });
  invalidateShadows(); dirty = true;
}
GLB.started = true; glbSettled();
// Точка доступа для снимков буклета, проверок и автоматизации.
function setToggle(t, open) { t.target = t.cur = open ? 1 : 0; applyTog(t); }
function view(spec) {
  viewLock = true; if (mode !== 'walk') setMode('walk');
  document.body.classList.toggle('capture', spec.ui !== true);
  if (spec.lighting && spec.lighting !== lighting) setLighting(spec.lighting);
  const doors = spec.doors ?? 'open';
  for (const t of TOG) {
    if (t.kind === 'door' && doors !== 'asis') setToggle(t, doors === 'open');
    else if (t.kind !== 'door' && spec.closeOthers !== false) setToggle(t, false);
  }
  for (const key of spec.open || []) for (const t of TOG) if (t.label === key || t.obj.userData.itemId === key) setToggle(t, true);
  invalidateShadows();
  const e = spec.eye, l = spec.look;
  camera.fov = spec.fov || 62; camera.up.set(0, 1, 0);
  camera.position.set(WX(e[0]), (e[2] ?? 160) * S, WZ(e[1]));
  const vertical = Math.hypot(e[0] - l[0], e[1] - l[1]) < 1e-3;          // взгляд строго сверху: другая ось «вверх»
  if (vertical) camera.up.set(0, 0, -1);
  camera.lookAt(WX(l[0]), (l[2] ?? 120) * S, WZ(l[1]));
  if (spec.aspect) camera.aspect = spec.aspect;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  renderer.render(scene, camera); dirty = false; return true;
}
// Изоляция предмета для листа шести видов: скрыть остальное, показать исходные детали вместо пакетов отрисовки.
const ISOLATE = { on: false, saved: new Map() };
function itemOf(o) { for (let q = o; q; q = q.parent) if (q.userData.itemId) return q.userData.itemId; return null; }
function isolate(id, opts = {}) {
  if (ISOLATE.on) restoreIsolation();
  if (!id) return true;
  ISOLATE.on = true; const keep = new Set([].concat(id));
  for (const g of [G.ceiling, G.exterior, G.trees, sky]) { ISOLATE.saved.set(g, g.visible); g.visible = false; }
  scene.traverse(o => { if (!o.isMesh && !o.isInstancedMesh) return; if (o === sky) return; if (G.exterior.children.includes(o)) return;
    ISOLATE.saved.set(o, o.visible); const mine = keep.has(itemOf(o)) && !o.userData.batch; o.visible = mine; });
  ISOLATE.bg = scene.background.getHex(); scene.background.set(opts.background ?? 0xeceae4);
  invalidateShadows(); return true;
}
function restoreIsolation() { for (const [o, v] of ISOLATE.saved) o.visible = v; ISOLATE.saved.clear(); if (ISOLATE.bg != null) scene.background.set(ISOLATE.bg); ISOLATE.on = false; invalidateShadows(); }
function release() { if (ISOLATE.on) restoreIsolation(); viewLock = false; document.body.classList.remove('capture'); resize(); dirty = true; }
window.TOUR = { PROJECT, TOG, ROOMS, PROJECT_ITEMS, state, setMode, setLighting, lookAtPlan, applyFinish, view, release, setToggle, isolate,
  get ready() { return texReady && GLB.waiting === 0; }, whenModelsReady: () => GLB.done, get models() { return { report: GLB.report.slice(), errors: GLB.errors.slice() }; }, get missingTextures() { return MISSING_TEX.slice(); }, get stats() { return { ...RENDER_STATS }; },
  go: i => { viewLock = false; eyeHeight = ROOMS[i].eyeHeight || 160; lookAtPlan(ROOMS[i].eye, ROOMS[i].look); setMode('walk'); } };
window.OFFICE = window.TOUR;

document.getElementById('captureBtn').onclick=()=>{
  renderer.render(scene,camera);
  renderer.domElement.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(PROJECT.meta?.id||'interior')+'-'+lighting+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);},'image/png');
};
addEventListener('keydown',e=>{if(e.code==='Escape'){$('panel').hidden=true;$('panelBtn').setAttribute('aria-expanded','false');$('help').hidden=true;}});
