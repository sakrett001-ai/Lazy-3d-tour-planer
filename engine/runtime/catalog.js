/* Движок интерьерных туров · каталог параметрической мебели и оборудования.
   Все построители берут план в сантиметрах; локальные размеры узлов — в метрах. */
/* ---------- мебель: вспомогательные ---------- */
function clothes(grp, u0, u1, y) { const cols = [0x2f3a45, 0x3b3f44, 0x1f2328, 0x6b5a4a, 0x4a5561, 0x2a2a2a];
  for (let u = u0, i = 0; u < u1; u += 9, i++) { const len = 85 + (i * 37 % 35); const m = new THREE.Mesh(new THREE.BoxGeometry(.05, len * S, .5), std({ color: cols[i % 6], roughness: .95 })); m.position.set(u * S, (y - len / 2 - 3) * S, .3); m.castShadow = true; grp.add(m); } }
function rboxL(w, h, d, r, mat) {
  const bev = Math.max(.000005, Math.min(r, w * .49, h * .49, d * .49));
  const g = new THREE.ExtrudeGeometry(roundedRect(Math.max(.00001, w - 2 * bev), Math.max(.00001, h - 2 * bev), bev * .3), { depth: Math.max(.00001, d - 2 * bev), bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 3, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * bev) / 2); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
}
// кресло: 'exec' — руководителя, 'task' — рабочее, 'sled' — для посетителей на полозьях, 'conf' — для переговоров
// Rounded cushion with eased front edge and shallow, continuous seat contour.
function cushion(w,h,d,r,mat,seat=false) {
  const m=rboxL(w,h,d,r,mat);
  if(seat) {
    const p=m.geometry.attributes.position;
    for(let i=0;i<p.count;i++) { const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      if(y>0) p.setY(i,y-.009*Math.max(0,1-(x/(w*.52))**2)*Math.max(0,1-(z/(d*.52))**2));
    } p.needsUpdate=true; m.geometry.computeVertexNormals();
  } return m;
}
function tube(points, radius, mat, parent, closed=false) {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new V3(...p)),closed,'centripetal');
  const m=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(12,points.length*5),radius,8,closed),mat);
  m.castShadow=radius>.008; m.receiveShadow=true; parent.add(m); return m;
}
function seatSeam(w,d,y,parent) {
  const a=w/2-.023,b=d/2-.025,r=.035;
  const p=[[-a+r,y,-b],[a-r,y,-b],[a,y,-b+r],[a,y,b-r],[a-r,y,b],[-a+r,y,b],[-a,y,b-r],[-a,y,-b+r]];
  return tube(p,.0017,MAT.seam,parent,true);
}
function officeChair(cx, cy, rot, kind = 'task') {
  const g=new THREE.Group();g.name='chair-'+kind;
  const put=(m,x,y,z)=>{m.position.set(x,y,z);g.add(m);return m;};
  const conf=kind==='conf'||kind==='sled',exec=kind==='exec';
  const up=kind==='conf'?MAT.sofaDark:MAT.leather, sw=exec?.55:.49, sh=.455;
  put(cushion(sw,.085,.49,.033,up,true),0,sh,.025);
  const seam=new THREE.Group();seam.position.z=.025;seatSeam(sw,.49,sh+.037,seam);g.add(seam);
  put(rboxL(sw-.055,.028,.40,.012,MAT.metal),0,sh-.055,.005);
  if(conf) {
    // Continuous cantilever runners. No upright tubes protrude into the upholstery.
    for(const sx of [-1,1]) {
      tube([[sx*.25,.025,-.23],[sx*.25,.025,.20],[sx*.25,.05,.26],[sx*.25,.40,.25],[sx*.25,.45,.20],[sx*.25,.45,-.18]],.013,MAT.steel,g);
      tube([[sx*.24,.43,-.20],[sx*.28,.60,-.19],[sx*.28,.64,-.10],[sx*.28,.64,.17]],.011,MAT.steel,g);
      put(rboxL(.057,.028,.29,.01,MAT.metal),sx*.28,.655,.025);
      for(const z of [-.15,.16]) put(rboxL(.034,.012,.05,.005,MAT.metal),sx*.25,.012,z);
    }
    const back=put(cushion(.48,.44,.077,.03,up),0,.725,-.245);back.rotation.x=-.12;
    for(const sx of [-1,1]) tube([[sx*.16,.42,-.18],[sx*.17,.56,-.28],[sx*.17,.83,-.31]],.012,MAT.steel,g);
  } else {
    // Five-star base with double-wheel castors and a telescoping gas lift.
    for(let i=0;i<5;i++) {
      const a=i*Math.PI*2/5, branch=new THREE.Group();branch.rotation.y=a;g.add(branch);
      tube([[0,.12,0],[0,.105,.13],[0,.072,.30]],.022,MAT.steel,branch);
      const axle=new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,.07,12),MAT.steel);axle.rotation.z=Math.PI/2;axle.position.set(0,.045,.30);branch.add(axle);
      for(const sx of [-1,1]) {const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.032,.032,.022,16),MAT.metal);wheel.rotation.z=Math.PI/2;wheel.position.set(sx*.025,.036,.30);branch.add(wheel);}
    }
    put(new THREE.Mesh(new THREE.CylinderGeometry(.034,.042,.19,18),MAT.metal),0,.19,0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(.021,.021,.19,18),MAT.steel),0,.335,0);
    const bh=exec?.66:.51;
    const shell=put(cushion(sw+.015,bh+.025,.075,.035,MAT.metal),0,sh+.10+bh/2,-.275);shell.rotation.x=-.12;
    const back=put(cushion(sw-.035,bh,.075,.035,exec?up:MAT.meshBack),0,sh+.10+bh/2,-.235);back.rotation.x=-.12;
    if(exec) {
      const head=put(cushion(.38,.16,.10,.04,up),0,1.25,-.30);head.rotation.x=-.12;
      for(const y of [-.19,0,.19]) tube([[-.20,y,.038],[-.10,y-.003,.039],[.10,y-.003,.039],[.20,y,.038]],.0015,MAT.seam,back);
    } else put(cushion(.31,.105,.06,.025,up),0,.67,-.19);
    for(const sx of [-1,1]) {
      tube([[sx*.18,.40,-.10],[sx*.285,.47,-.09],[sx*.285,.65,-.07]],.018,MAT.metal,g);
      put(rboxL(.073,.036,.265,.014,up),sx*.285,.677,.005);
    }
    tube([[.15,.40,0],[.28,.39,.08]],.007,MAT.metal,g);
    put(rboxL(.075,.025,.025,.01,MAT.metal),.29,.39,.08);
  }
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  g.position.set(WX(cx),0,WZ(cy));g.rotation.y=rot;G.interior.add(g);
  blob(cx-30,cy-30,cx+30,cy+30,.28);return g;
}
function sofa(x0,y0,x1,y1,facing,mat=MAT.leather) {
  const alongY=facing==='W'||facing==='E',w=(alongY?y1-y0:x1-x0)*S,d=(alongY?x1-x0:y1-y0)*S;
  const g=new THREE.Group();g.name='sofa';g.position.set(WX((x0+x1)/2),0,WZ((y0+y1)/2));
  g.rotation.y={S:0,N:Math.PI,E:Math.PI/2,W:-Math.PI/2}[facing];G.interior.add(g);
  const put=(m,x,y,z)=>{m.position.set(x,y,z);g.add(m);return m;};
  put(rboxL(w-.08,.17,d-.07,.035,mat),0,.245,0);
  put(rboxL(w-.17,.08,d-.16,.015,MAT.shadowGap),0,.13,0);
  for(const sx of [-1,1]) for(const sz of [-1,1]) put(new THREE.Mesh(new THREE.CylinderGeometry(.018,.013,.12,12),MAT.steel),sx*(w/2-.10),.06,sz*(d/2-.10));
  for(const sx of [-1,1]) put(cushion(.13,.43,d-.025,.04,mat),sx*(w/2-.065),.405,0);
  put(cushion(w-.22,.48,.125,.04,mat),0,.575,-d/2+.065);
  const n=w<1.1?1:Math.max(2,Math.round((w-.28)/.62)),cw=(w-.28)/n;
  for(let i=0;i<n;i++) {
    const x=-(w-.28)/2+cw*(i+.5);
    put(cushion(cw-.012,.125,d-.20,.04,mat,true),x,.405,.055);
    const back=put(cushion(cw-.015,.35,.13,.04,mat),x,.615,-d/2+.17);back.rotation.x=-.12;
    const sg=new THREE.Group();sg.position.set(x,0,.055);seatSeam(cw-.012,d-.20,.46,sg);g.add(sg);
  }
  blob(x0,y0,x1,y1,.32);return g;
}
function monitor(x,y,rot,w=58) {
  const g=new THREE.Group();const put=(m,x,y,z)=>{m.position.set(x,y,z);g.add(m);return m;};
  put(rboxL(.23,.012,.17,.008,MAT.steel),0,.006,-.025);
  put(rboxL(.039,.24,.03,.008,MAT.steel),0,.13,-.065);
  const display=new THREE.Group();display.position.set(0,.35,-.035);display.rotation.x=-.04;g.add(display);
  display.add(rboxL(w*S,w*.565*S,.027,.008,MAT.metal));
  const scr=new THREE.Mesh(new THREE.PlaneGeometry((w-1.2)*S,(w*.565-1.2)*S),MAT.screen);scr.position.z=.014;display.add(scr);
  put(rboxL(.425,.015,.14,.005,MAT.metal),0,.012,.25);
  // One instanced keyboard, so key detail does not multiply draw calls.
  const keysMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.018,.005,.021),MAT.shadowGap,60),m=new THREE.Matrix4();
  for(let r=0;r<4;r++)for(let c=0;c<15;c++){m.makeTranslation(-.187+c*.026,.023,.20+r*.027);keysMesh.setMatrixAt(r*15+c,m);}g.add(keysMesh);
  put(cushion(.059,.026,.098,.015,MAT.metal),.30,.019,.26);
  g.position.set(WX(x),.76,WZ(y));g.rotation.y=rot;G.interior.add(g);return g;
}
function papers(x,y,n=3,h0=76) {
  for(let i=0;i<n;i++) {const m=B(MAT.whiteMatte,x-10.5+i*.4,y-14.8+i*.3,x+10.5+i*.4,y+14.8+i*.3,h0+i*.035,h0+.035+i*.035);m.rotation.y=i*.018;m.castShadow=false;}
  B(MAT.book[1],x-9,y-10,x+6,y-9.85,h0+n*.035+.01,h0+n*.035+.012,G.interior,false);
}
function deskLamp(x,y,h0=76) {
  const g=new THREE.Group();g.position.set(WX(x),h0*S,WZ(y));G.interior.add(g);
  const base=rboxL(.16,.018,.12,.009,MAT.metal);base.position.y=.009;g.add(base);
  tube([[0,.015,0],[0,.23,-.035],[0,.44,-.08],[0,.46,.09]],.008,MAT.steel,g);
  const shade=rboxL(.25,.03,.065,.012,MAT.metal);shade.position.set(.03,.465,.09);g.add(shade);
  const emitter=new THREE.Mesh(new THREE.PlaneGeometry(.21,.042),MAT.lampEmit);emitter.rotation.x=Math.PI/2;emitter.position.set(.03,.448,.09);g.add(emitter);
}
function mug(x,y,h0=91) {
  const g=new THREE.Group();g.position.set(WX(x),h0*S,WZ(y));G.interior.add(g);
  const profile=[[0,0],[.031,0],[.037,.01],[.038,.089],[.033,.09],[.031,.015],[0,.014]].map(p=>new V2(...p));
  const cup=new THREE.Mesh(new THREE.LatheGeometry(profile,32),MAT.ceramic);cup.castShadow=cup.receiveShadow=true;g.add(cup);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.025,.006,10,24,Math.PI*1.55),MAT.ceramic);handle.position.set(.04,.05,0);handle.rotation.z=-Math.PI*.775;g.add(handle);
  const coffee=new THREE.Mesh(new THREE.CircleGeometry(.030,24),std({color:0x33251e,roughness:.25}));coffee.rotation.x=-Math.PI/2;coffee.position.y=.064;g.add(coffee);
}
function coffeeMachine(cx=1070,cy=293,rot=Math.PI/2,h0=91) {
  const g=new THREE.Group();g.name='coffee-machine';g.position.set(WX(cx),h0*S,WZ(cy));g.rotation.y=rot;G.interior.add(g);
  const put=(m,x,y,z)=>{m.position.set(x,y,z);g.add(m);return m;};
  put(rboxL(.27,.33,.30,.015,MAT.metal),0,.165,0);
  put(rboxL(.22,.15,.015,.008,MAT.steel),0,.235,.155);
  put(rboxL(.075,.04,.005,.003,MAT.blackGlass),0,.262,.167);
  put(rboxL(.16,.035,.018,.005,MAT.metal),0,.185,.17);
  for(const x of [-.035,.035])put(new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.025,12),MAT.steel),x,.155,.18);
  put(rboxL(.21,.015,.12,.007,MAT.steel),0,.015,.18);
  for(let i=0;i<7;i++)put(rboxL(.16,.002,.003,.001,MAT.shadowGap),0,.024,.14+i*.013);
  const dial=put(new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.009,18),MAT.chrome),.08,.262,.17);dial.rotation.x=Math.PI/2;
}
function deskPhone(x,y,rot=0,h0=76) {
  const g=new THREE.Group();g.position.set(WX(x),h0*S,WZ(y));g.rotation.y=rot;G.interior.add(g);
  const base=rboxL(.20,.045,.17,.012,MAT.metal);base.position.y=.027;g.add(base);
  const screen=rboxL(.075,.007,.047,.003,MAT.blackGlass);screen.position.set(.02,.053,-.04);g.add(screen);
  tube([[-.065,.074,-.069],[-.072,.08,-.049],[-.075,.065,.02],[-.072,.08,.065],[-.065,.074,.075]],.018,MAT.metal,g);
  const keys=new THREE.InstancedMesh(new THREE.BoxGeometry(.018,.004,.013),MAT.steel,12),m=new THREE.Matrix4();
  for(let r=0;r<4;r++)for(let c=0;c<3;c++){m.makeTranslation(-.003+c*.026,.052,.012+r*.019);keys.setMatrixAt(r*3+c,m);}g.add(keys);
}

const R = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };   // куда смотрит сидящий: S = +y, E = +x

// стол: столешница + две опоры-панели (или тумбы)
function desk(x0, y0, x1, y1, h = 75, opts = {}) {
  RB(MAT.furn, x0, y0, x1, y1, h - 4, h, .6);
  if (opts.inlay) RB(MAT.leatherInlay, x0 + (opts.inlayX0 ?? 8), y0 + 8, x1 - (opts.inlayX1 ?? 8), y1 - 8, h, h + .3, .2);
  const alongX = (x1 - x0) >= (y1 - y0);
  if (opts.pedestals) {
    if (alongX) { B(MAT.furn, x0 + 2, y0 + 4, x0 + 44, y1 - 4, 0, h - 4); B(MAT.furn, x1 - 44, y0 + 4, x1 - 2, y1 - 4, 0, h - 4); }
    else { B(MAT.furn, x0 + 4, y0 + 2, x1 - 4, y0 + 44, 0, h - 4); B(MAT.furn, x0 + 4, y1 - 44, x1 - 4, y1 - 2, 0, h - 4); }
    if (opts.modesty) { if (alongX) B(MAT.furn, x0 + 44, opts.modesty > 0 ? y1 - 6 : y0 + 4, x1 - 44, opts.modesty > 0 ? y1 - 4 : y0 + 6, 18, h - 4); else B(MAT.furn, opts.modesty > 0 ? x1 - 6 : x0 + 4, y0 + 44, opts.modesty > 0 ? x1 - 4 : x0 + 6, y1 - 44, 18, h - 4); }
  } else {
    if (alongX) { B(MAT.metal, x0 + 3, y0 + 5, x0 + 6, y1 - 5, 0, h - 4); B(MAT.metal, x1 - 6, y0 + 5, x1 - 3, y1 - 5, 0, h - 4); }
    else { B(MAT.metal, x0 + 5, y0 + 3, x1 - 5, y0 + 6, 0, h - 4); B(MAT.metal, x0 + 5, y1 - 6, x1 - 5, y1 - 3, 0, h - 4); }
  }
  if(alongX) B(MAT.shadowGap,x0+7,y0+7,x1-7,y1-7,h-5.5,h-4);
  else B(MAT.shadowGap,x0+7,y0+7,x1-7,y1-7,h-5.5,h-4);
  blob(x0, y0, x1, y1, .25);
}

// телевизор/экран, закреплённый на стене; facing: 'x+' (экран смотрит в +x) или 'x-'
function wallScreen(x, y, facing, w, h, h0, tex2) {
  const grp = new THREE.Group(); const d = 3;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), MAT.metal); grp.add(body);
  const scrM = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: .12, emissive: 0xffffff, emissiveMap: tex2 || tvTex, emissiveIntensity: 0 }); ALL_MATS.push(scrM);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry((w - 2) * S, (h - 2) * S), scrM); scr.position.z = d / 2 * S + .001; grp.add(scr);
  if (facing === 'x+' || facing === 'x-') { grp.position.set(WX(x) + (facing === 'x+' ? d / 2 * S : -d / 2 * S), (h0 + h / 2) * S, WZ(y)); grp.rotation.y = facing === 'x+' ? Math.PI / 2 : -Math.PI / 2; }
  else if (facing === 'y+' || facing === 'y-') { grp.position.set(WX(x), (h0 + h / 2) * S, WZ(y) + (facing === 'y+' ? d / 2 * S : -d / 2 * S)); grp.rotation.y = facing === 'y+' ? 0 : Math.PI; }
  else throw new Error('wallScreen.facing: x+ | x- | y+ | y- (куда смотрит экран), получено ' + facing);
  grp.traverse(o => o.castShadow = true); G.interior.add(grp);
  const t = { obj: grp, axis: 'fn', open: 1, cur: 0, target: 0, label: 'Экран', fn: v => { scrM.emissiveIntensity = v * 1.1; } };
  grp.traverse(o => o.userData.tog = t); TOG.push(t); return t;
}

// Reusable furniture and appliance units, all dimensions in metres locally.
const FITOUT={workstations:[],stations:[],outlets:[],diningChairs:[],chandeliers:[]};
function unitMesh(parent,mesh,x=0,y=0,z=0){if(mesh.material===MAT.furn)furnitureUV(mesh);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function unitBox(parent,mat,w,h,d,x,y,z,r=.006){return unitMesh(parent,r>.006?rboxL(w,h,d,r,mat):new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat),x,y,z);}
function refreshmentStation(cx,cy,rotation,room,compact=false){
  const g=new THREE.Group();g.name='coffee-station-'+room;g.position.set(WX(cx),0,WZ(cy));g.rotation.y=rotation;G.interior.add(g);
  // A 120 x 54 cm counter with a ventilated appliance niche and closed storage.
  unitBox(g,MAT.counter,compact?.55:1.20,.03,.54,0,.895,0,.008);
  let storeToggle=null;
  if(compact){
    for(const x of [-.266,.266])unitBox(g,MAT.furn,.018,.85,.51,x,.435,0);
    unitBox(g,MAT.shadowGap,.51,.035,.43,0,.0175,-.025);
  }else{
  unitBox(g,MAT.furn,.018,.80,.51,.591,.45,0);
  unitBox(g,MAT.furn,.018,.80,.51,-.591,.45,0);
  unitBox(g,MAT.furn,.018,.80,.51,-.075,.45,0);
  unitBox(g,MAT.furn,.645,.018,.49,.256,.063,0);
  unitBox(g,MAT.furn,.645,.77,.018,.256,.46,-.245);
  for(const h of [.30,.58])unitBox(g,MAT.whiteMatte,.64,.012,.47,.256,h,-.01);
  unitBox(g,MAT.shadowGap,1.13,.07,.43,0,.035,-.035);
  const storage=new THREE.Group();storage.position.set(.581,0,.269);g.add(storage);
  unitBox(storage,MAT.furn,.638,.786,.019,-.323,.458,0);
  unitBox(storage,MAT.metal,.14,.012,.025,-.48,.80,.021,.004);
  storeToggle=cabinetHinge(storage,Math.PI/2,false,'Тумба · '+room);storeToggle.userDataRole='station-storage';
  }
  // 48 cm mini fridge: shell, recessed cavity, shelves, gasket and real door.
  const fridge=new THREE.Group();fridge.name='mini-fridge-'+room;fridge.position.set(compact?0:-.33,0,0);g.add(fridge);
  unitBox(fridge,MAT.whiteMatte,.018,.80,.47,-.231,.425,0);
  unitBox(fridge,MAT.whiteMatte,.018,.80,.47,.231,.425,0);
  unitBox(fridge,MAT.whiteMatte,.444,.80,.018,0,.425,-.226);
  unitBox(fridge,MAT.whiteMatte,.444,.018,.452,0,.034,0);
  unitBox(fridge,MAT.whiteMatte,.444,.018,.452,0,.816,0);
  for(const h of [.23,.46,.67])unitBox(fridge,MAT.whiteLac,.43,.008,.42,0,h,-.007,.002);
  for(const x of [-.135,0,.135]){
    unitMesh(fridge,new THREE.Mesh(new THREE.CylinderGeometry(.026,.029,.15,14),MAT.ceramic),x,.113,-.05);
    unitBox(fridge,MAT.metal,.045,.012,.045,x,.194,-.05,.004);
  }
  const door=new THREE.Group();door.position.set(-.24,0,.254);fridge.add(door);
  unitBox(door,MAT.shadowGap,.474,.797,.012,.24,.425,-.012,.008);
  unitBox(door,MAT.whiteLac,.478,.803,.028,.24,.425,.009,.012);
  unitBox(door,MAT.steel,.018,.21,.03,.431,.64,.037,.007);
  unitBox(door,MAT.steel,.07,.015,.002,.15,.765,.024,.003);
  const fridgeToggle=cabinetHinge(door,-Math.PI/2,false,'Холодильник · '+room);fridgeToggle.userDataRole='fridge';
  g.userData.room=room;FITOUT.stations.push({g,room,fridge,door,fridgeToggle,storeToggle});return g;
}
function kettle(cx,cy,rotation=0,h0=91){
  const g=new THREE.Group();g.name='electric-kettle';g.position.set(WX(cx),h0*S,WZ(cy));g.rotation.y=rotation;G.interior.add(g);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.093,.10,.018,28),MAT.metal),0,.009,0);
  const profile=[[.072,.019],[.087,.04],[.084,.14],[.073,.22],[.057,.25]].map(p=>new V2(...p));
  unitMesh(g,new THREE.Mesh(new THREE.LatheGeometry(profile,32),MAT.steel));
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.059,.061,.012,28),MAT.metal),0,.254,0);
  unitBox(g,MAT.metal,.038,.017,.024,0,.267,0,.007);
  tube([[.066,.214,0],[.126,.21,0],[.138,.12,0],[.109,.062,0],[.079,.064,0]],.014,MAT.metal,g);
  const spout=unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.027,.038,.08,20,1,true),MAT.steel),-.078,.215,0);spout.rotation.z=.65;
  unitBox(g,MAT.blackGlass,.018,.102,.005,0,.138,.084,.004);
  unitBox(g,MAT.metal,.038,.009,.025,.094,.06,0,.003);
  return g;
}
function powerSocket(cx,cy,h,rotation,room,purpose){
  const g=new THREE.Group();g.name='socket-'+purpose;g.position.set(WX(cx),h*S,WZ(cy));g.rotation.y=rotation;G.interior.add(g);
  unitBox(g,MAT.whiteMatte,.082,.082,.010,0,0,.003,.008);
  unitMesh(g,new THREE.Mesh(new THREE.CircleGeometry(.025,24),MAT.linen),0,0,.009);
  for(const x of [-.009,.009])unitMesh(g,new THREE.Mesh(new THREE.CircleGeometry(.0038,12),MAT.shadowGap),x,0,.0094);
  for(const y of [-.022,.022])unitBox(g,MAT.steel,.009,.004,.001,0,y,.010,.001);
  g.traverse(o=>{o.castShadow=false;});FITOUT.outlets.push({g,room,purpose,heightCm:h});return g;
}
function diningChair(cx,cy,rotation,room='rest'){
  const g=new THREE.Group();g.name='chair-dining';g.position.set(WX(cx),0,WZ(cy));g.rotation.y=rotation;G.interior.add(g);
  unitMesh(g,cushion(.42,.065,.42,.027,MAT.sofaDark,true),0,.465,.005);
  unitBox(g,MAT.furn,.38,.035,.37,0,.41,0,.009);
  for(const x of [-.165,.165])for(const z of [-.15,.15]){
    const leg=unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.014,.018,.395,12),MAT.furn),x,.207,z);leg.rotation.z=-Math.sign(x)*.06;
  }
  const back=unitMesh(g,cushion(.415,.285,.05,.022,MAT.sofaDark),0,.675,-.20);back.rotation.x=-.10;
  for(const x of [-.155,.155])tube([[x,.39,-.14],[x,.51,-.202],[x,.76,-.217]],.014,MAT.furn,g);
  g.userData.room=room;FITOUT.diningChairs.push(g);blob(cx-23,cy-23,cx+23,cy+23,.20);return g;
}
function diningTable(cx,cy,diameter=84){
  const g=new THREE.Group();g.name='round-dining-table';g.position.set(WX(cx),0,WZ(cy));G.interior.add(g);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(diameter*S/2,diameter*S/2,.03,64),MAT.furn),0,.745,0);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.07,.085,.70,28),MAT.metal),0,.365,0);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.255,.265,.022,48),MAT.metal),0,.013,0);
  g.userData.diameterCm=diameter;FITOUT.diningTable=g;blob(cx-42,cy-42,cx+42,cy+42,.21);return g;
}
function chandelier(cx,cy){
  const g=new THREE.Group();g.name='office-chandelier';g.position.set(WX(cx),0,WZ(cy));G.ceiling.add(g);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,.027,24),MAT.metal),0,2.984,0);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.42,12),MAT.brass),0,2.767,0);
  unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.058,.058,.07,20),MAT.brass),0,2.535,0);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,dx=Math.cos(a),dz=Math.sin(a);
    tube([[dx*.025,2.535,dz*.025],[dx*.23,2.535,dz*.23],[dx*.37,2.49,dz*.37]],.008,MAT.brass,g);
    unitMesh(g,new THREE.Mesh(new THREE.SphereGeometry(.09,20,12),MAT.lampEmit),dx*.37,2.405,dz*.37);
    unitMesh(g,new THREE.Mesh(new THREE.CylinderGeometry(.025,.03,.035,16),MAT.brass),dx*.37,2.493,dz*.37);
  }
  g.traverse(o=>{o.castShadow=false;});FITOUT.chandeliers.push(g);
  beam(cx,cy,2.30,'panel',0xf9f1df,1.12,true);return g;
}

function wardrobe(cx,cy,rot,width,label){return cabinet(cx,cy,rot,width,58,0,230,{plinth:6,body:MAT.furn,rods:[[2,width-2,190]],shelves:[[0,width,200]],fill:(box,grp)=>clothes(grp,10,width-10,188),doors:[{type:'L',u0:0,u1:width/2,mat:MAT.furn,tall:true,hy:110,label},{type:'R',u0:width/2,u1:width,mat:MAT.furn,tall:true,hy:110,label}]});}
function documentsCabinet(cx,cy,rot,width,depth,height,label){return cabinet(cx,cy,rot,width,depth,0,height,{plinth:6,body:MAT.furn,shelves:[40,80,120,160,200].filter(h=>h<height-10).map(h=>[0,width,h]),fill:(box)=>{for(const h of [42,82,122,162])if(h<height-25)for(let x=6;x<width-7;x+=8)box(x,h,4,x+5,h+26,depth-8,MAT.book[Math.floor(x/8)%5]);},doors:[{type:'L',u0:0,u1:width/2,mat:MAT.furn,tall:true,hy:110,label},{type:'R',u0:width/2,u1:width,mat:MAT.furn,tall:true,hy:110,label}]});}
function receptionPrinter(x,y,h=76){
 const g=new THREE.Group();g.name='printer';g.position.set(WX(x),h*S,WZ(y));G.interior.add(g);
 unitBox(g,MAT.whiteLac,.50,.32,.43,0,.16,0,.01);
 unitBox(g,MAT.whiteLac,.50,.06,.075,0,.03,.2525,.006);
 unitBox(g,MAT.whiteLac,.50,.018,.075,0,.30,.2525,.006);
 unitBox(g,MAT.metal,.475,.21,.006,0,.177,.219,.002);
 unitBox(g,MAT.whiteMatte,.45,.022,.38,0,.335,-.01,.009);
 const panel=unitBox(g,MAT.blackGlass,.13,.035,.06,.155,.345,.185,.004);panel.rotation.x=-.2;
 return g;
}

/* ================== КАТАЛОГ: обёртки для данных проекта ================== */
// Каждая запись каталога принимает объект параметров из project.json.
const CATALOG = {}, CUSTOM = {};
function matByName(n, fallback) {
  if (n == null) return fallback;
  if (typeof n !== 'string') return n;
  if (n.startsWith('book:')) return MAT.book[+n.slice(5)];
  if (!MAT[n]) throw new Error('Неизвестный материал: ' + n);
  return MAT[n];
}
function groupOf(n) { if (!n) return G.interior; if (!G[n]) throw new Error('Неизвестная группа: ' + n); return G[n]; }
function rotOf(v) { if (v == null) return 0; if (typeof v === 'string') { if (!(v in R)) throw new Error('Неизвестное направление: ' + v); return R[v]; } return v * Math.PI / 180; }
function colorOf(v, d) { if (v == null) return d; return typeof v === 'string' ? parseInt(v.replace('#', ''), 16) : v; }
function named(o, p) { if (p.name && o && o.isObject3D) o.name = p.name; return o; }

// --- примитивы ---
// plan: 'seat' | 'furniture' | 'dark' | 'wet' | 'equipment' — показать примитив на плане этой заливкой.
function primitivePlan(p, sym) { if (p.plan) planSymbol({ ...sym, category: p.plan }); }
CATALOG.box = p => { const m = B(matByName(p.mat), ...p.box, groupOf(p.group), p.cast !== false); if (p.cast === false) m.castShadow = false; primitivePlan(p, { kind: 'rect', rect: p.box.slice(0, 4) }); return named(m, p); };
CATALOG.rbox = p => { const m = RB(matByName(p.mat), ...p.box, p.r ?? 3, groupOf(p.group)); primitivePlan(p, { kind: 'rect', rect: p.box.slice(0, 4) }); return named(m, p); };
CATALOG.cyl = p => { const m = CYL(matByName(p.mat), p.at[0], p.at[1], p.r, p.h[0], p.h[1], p.seg ?? 24, groupOf(p.group), p.r2); if (p.cast === false) m.castShadow = false; primitivePlan(p, { kind: 'circle', c: p.at, r: p.r }); return named(m, p); };
CATALOG.blob = p => blob(...p.rect, p.op ?? .45, p.h ?? .12);
CATALOG.plant = p => plant(p.at[0], p.at[1], p.k ?? 1, p.base ?? 0);
CATALOG.planSymbol = p => planSymbol(p.symbol);
// Подъёмный фасад: группа деталей поднимается на rise см по нажатию.
CATALOG.liftFront = p => {
  const cover = new THREE.Group(); cover.name = p.name || 'lift-front'; G.interior.add(cover);
  for (const q of p.parts) B(matByName(q.mat), ...q.box, cover);
  const t = { obj: cover, axis: 'fn', open: 1, cur: 0, target: 0, label: p.toggleLabel || p.label, affectsShadow: true, fn: v => { cover.position.y = v * p.rise * S; } };
  cover.traverse(o => o.userData.tog = t); TOG.push(t); if (p.fitout) FITOUT[p.fitout] = t; return t;
};

// --- рабочие места ---
CATALOG.desk = p => { desk(...p.rect, p.h ?? 75, p); };
CATALOG.officeChair = p => { const g = officeChair(p.at[0], p.at[1], rotOf(p.rot), p.kind || 'task'); if (p.plan !== false) planSymbol({ kind: 'bounds', category: 'seat', obj: g }); return named(g, p); };
CATALOG.monitor = p => { const g = monitor(p.at[0], p.at[1], rotOf(p.rot), p.w ?? 58); if (p.h != null) g.position.y = p.h * S; return named(g, p); };
CATALOG.papers = p => papers(p.at[0], p.at[1], p.n ?? 3, p.h ?? 76);
CATALOG.deskLamp = p => deskLamp(p.at[0], p.at[1], p.h ?? 76);
CATALOG.deskPhone = p => deskPhone(p.at[0], p.at[1], rotOf(p.rot), p.h ?? 76);
CATALOG.printer = p => { planSymbol({ kind: 'rect', rect: [p.at[0] - 25, p.at[1] - 22, p.at[0] + 25, p.at[1] + 23], category: 'equipment', text: p.planText ?? 'МФУ' }); return named(receptionPrinter(p.at[0], p.at[1], p.h ?? 76), p); };
CATALOG.wallScreen = p => { const t = wallScreen(p.at[0], p.at[1], p.facing, p.w, p.hgt, p.h0); if (p.name) t.obj.name = p.name; if (p.toggleLabel) t.label = p.toggleLabel; if (p.fitout) FITOUT[p.fitout] = t;
  if (p.bar) {  // панель ВКС под экраном: звуковая панель с объективом камеры, условный комплект
    const bw = (p.barWidth ?? 72) * S, y = -(p.hgt / 2 + 8.5) * S, z = .015 + .04;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, .09, .08), MAT.metal); bar.position.set(0, y, z); bar.castShadow = true; bar.name = 'vcs-videobar'; t.obj.add(bar);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .02, 24), MAT.blackGlass); lens.rotation.x = Math.PI / 2; lens.position.set(0, y, z + .045); lens.name = 'vcs-camera'; t.obj.add(lens);
    for (const k of [-3, -2, 2, 3]) { const g = new THREE.Mesh(new THREE.BoxGeometry(.08, .05, .002), MAT.soot); g.position.set(k * bw / 8, y, z + .0405); t.obj.add(g); }
    t.obj.traverse(o => o.userData.tog = t);
  }
  planSymbol({ kind: 'bounds', category: 'dark', obj: t.obj }); return t; };

// --- мягкая мебель и столы ---
CATALOG.sofa = p => { const g = sofa(...p.rect, p.facing, matByName(p.mat, MAT.leather)); if (p.seats) g.userData.seats = p.seats; if (p.fitout) FITOUT[p.fitout] = g;
  const alongY = p.facing === 'W' || p.facing === 'E', n = Math.max(1, p.seats || 1), [x0, y0, x1, y1] = p.rect, lines = [];
  for (let i = 1; i < n; i++) { if (alongY) { const y = y0 + (y1 - y0) * i / n; lines.push([[x0 + 12, y], [x1 - 10, y]]); } else { const x = x0 + (x1 - x0) * i / n; lines.push([[x, y0 + 12], [x, y1 - 10]]); } }
  planSymbol({ kind: 'lines', lines, color: '#718d7c' }); return named(g, p); };
CATALOG.roundSideTable = p => { const [x, y] = p.at, r = (p.d ?? 36) / 2, h = p.h ?? 51; CYL(MAT.furn, x, y, r, h - 3, h, 32); CYL(MAT.metal, x, y, 3, 2, h - 3, 16); CYL(MAT.metal, x, y, 14, 0, 2, 24); planSymbol({ kind: 'circle', c: [x, y], r }); };
CATALOG.diningTable = p => { const d = p.d ?? 84, g = diningTable(p.at[0], p.at[1], d); COLLIDERS.circles.push({ c: p.at, r: d / 2, n: 24, t: 1 }); planSymbol({ kind: 'circle', c: p.at, r: d / 2 }); return g; };
CATALOG.diningChair = p => { const g = diningChair(p.at[0], p.at[1], rotOf(p.rot), p.room || 'rest'); COLLIDERS.oriented.push({ obj: g, corners: [[-.23, -.25], [.23, -.25], [.23, .23], [-.23, .23]], t: 1 }); return g; };

// --- хранение ---
function fillOf(f, D) {
  if (!f) return undefined;
  if (f.kind === 'clothes') return (box, grp) => clothes(grp, f.u[0], f.u[1], f.y);
  if (f.kind === 'plates') return (box) => { for (const h of f.levels) for (let k = 0; k < (f.count ?? 4); k++) box(f.u[0], h + k * .7, f.z[0], f.u[1], h + k * .7 + .5, f.z[1], MAT.ceramic); };
  throw new Error('Неизвестное наполнение: ' + f.kind);
}
function cabinetOpts(p) {
  const label = p.doorLabel ?? p.label;
  return { plinth: p.plinth, body: matByName(p.body, MAT.whiteMatte), inner: matByName(p.inner), frontT: p.frontT, upper: p.upper,
    parts: p.partitions, shelves: p.shelves, rods: p.rods, fill: fillOf(p.fill, p.D),
    doors: (p.doors || []).map(d => ({ ...d, mat: matByName(d.mat), label: d.label ?? label })) };
}
CATALOG.cabinet = p => named(cabinet(p.at[0], p.at[1], rotOf(p.rot), p.W, p.D, p.h[0], p.h[1], cabinetOpts(p)), p);
CATALOG.wardrobe = p => named(wardrobe(p.at[0], p.at[1], rotOf(p.rot), p.width, p.doorLabel ?? p.label), p);
CATALOG.documentsCabinet = p => named(documentsCabinet(p.at[0], p.at[1], rotOf(p.rot), p.width, p.depth, p.height, p.doorLabel ?? p.label), p);
// Книжный шкаф: n секций, открытые полки с книгами сверху, распашные дверцы снизу.
CATALOG.bookcase = p => {
  const width = p.width, D = p.depth ?? 38, H = p.height ?? 225, n = p.bays ?? 3, bay = width / n, levels = p.shelves ?? [90, 130, 170], label = p.doorLabel ?? p.label;
  return named(cabinet(p.at[0], p.at[1], rotOf(p.rot), width, D, 0, H, {
    plinth: p.plinth ?? 8, body: matByName(p.body, MAT.furn), parts: Array.from({ length: n - 1 }, (_, k) => bay * (k + 1)),
    shelves: levels.flatMap(h => Array.from({ length: n }, (_, i) => [i * bay + (i ? 1 : 1.8), (i + 1) * bay - (i < n - 1 ? 1 : 1.8), h])),
    fill: (box) => { for (let section = 0; section < n; section++) for (let r = 0; r < levels.length; r++) for (let u = section * bay + 4; u < (section + 1) * bay - 10; u += 8.5) { if ((u * 7 + r * 13) % 11 < 2) continue; box(u, levels[r] + 2, 8, u + 6.8, levels[r] + 28 + (u % 3) * 3, D - 6, MAT.book[(Math.floor(u / 8.5) + r) % 5]); } },
    doors: Array.from({ length: n * 2 }, (_, i) => ({ type: i % 2 ? 'R' : 'L', u0: i * width / (n * 2), u1: (i + 1) * width / (n * 2), y1: p.doorsTo ?? 88, mat: matByName(p.body, MAT.furn), label }))
  }), p);
};

// --- кухонное и бытовое оборудование ---
CATALOG.refreshmentStation = p => {
  const g = refreshmentStation(p.at[0], p.at[1], rotOf(p.rot), p.room || 'room', !!p.compact);
  if (p.fridgeFront) { const st = FITOUT.stations[FITOUT.stations.length - 1], m = matByName(p.fridgeFront);
    st.fridgeToggle.obj.traverse(o => { if (o.isMesh && o.material === MAT.whiteLac) { o.material = m; if (m === MAT.furn) furnitureUV(o); } }); }
  return g;
};
CATALOG.coffeeMachine = p => coffeeMachine(p.at[0], p.at[1], rotOf(p.rot ?? 90), p.h ?? 91);
CATALOG.kettle = p => kettle(p.at[0], p.at[1], rotOf(p.rot), p.h ?? 91);
CATALOG.mug = p => mug(p.at[0], p.at[1], p.h ?? 91);
CATALOG.powerSocket = p => powerSocket(p.at[0], p.at[1], p.h, rotOf(p.rot), p.room, p.purpose);

// --- свет ---
CATALOG.chandelier = p => chandelier(p.at[0], p.at[1]);
CATALOG.panelLamp = p => panelLamp(p.at[0], p.at[1], p.w ?? 60, p.d ?? 60);
CATALOG.downLight = p => downLight(p.at[0], p.at[1], !!p.shadow);
CATALOG.beam = p => beam(p.at[0], p.at[1], p.z * S, p.kind || 'panel', colorOf(p.color, 0xf9f1df), p.angle ?? .88, !!p.shadow);

// --- табличка на стене ---
CATALOG.plaque = p => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = p.bg || '#2d3a4a'; g.fillRect(0, 0, 512, 256); g.strokeStyle = p.frame || '#c8a86a'; g.lineWidth = 6; g.strokeRect(12, 12, 488, 232);
  g.fillStyle = p.ink || '#f2ead8'; g.textAlign = 'center'; g.font = '600 46px Manrope, Arial, sans-serif'; g.fillText(p.text[0] || '', 256, 112); g.font = '500 34px Manrope, Arial, sans-serif'; g.fillText(p.text[1] || '', 256, 170);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry((p.size?.[0] ?? 36) * S, (p.size?.[1] ?? 18) * S), new THREE.MeshStandardMaterial({ map: t, roughness: .35, metalness: .2 }));
  m.position.set(WX(p.at[0]), p.h * S, WZ(p.at[1])); m.rotation.y = rotOf(p.rot); G.interior.add(m); return m;
};


/* ---------- готовые 3D-модели (GLB) ----------
   Файл встраивается сборкой в window.TOUR_ASSETS. Модель ставится на пол в точку at,
   поворачивается на rot, масштаб glTF — метры (scale — явный множитель, если автор ошибся с единицами).
   expect: [ширина, глубина, высота] в см по паспорту изделия — после загрузки габариты сверяются с допуском. */
const GLB = { waiting: 0, loaded: [], errors: [], report: [] };
let glbResolve; GLB.done = new Promise(r => { glbResolve = r; });
function glbSettled() { if (GLB.waiting === 0 && GLB.started) glbResolve(GLB.report); }
function base64Buffer(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; }
CATALOG.glb = p => {
  const holder = new THREE.Group(); holder.name = p.name || ('glb:' + p.src);
  holder.position.set(WX(p.at[0]), (p.y ?? 0) * S, WZ(p.at[1])); holder.rotation.y = rotOf(p.rot); G.interior.add(holder);
  const data = (window.TOUR_ASSETS || {})[p.src];
  if (!data) throw new Error('Модель не встроена в сборку: ' + p.src);
  if (!THREE.GLTFLoader) throw new Error('В сборке нет загрузчика GLB');
  GLB.waiting++; GLB.started = true;
  const itemId = CURRENT_ITEM?.id, room = CURRENT_ITEM?.room ?? p.room;
  new THREE.GLTFLoader().parse(base64Buffer(data), '', gltf => {
    const model = gltf.scene, k = p.scale ?? 1; model.scale.setScalar(k);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new V3()), c = box.getCenter(new V3());
    // посадка: низ модели на пол, центр габарита — в точку at (anchor: 'origin' — оставить начало координат модели)
    if (p.anchor !== 'origin') model.position.set(-c.x, -box.min.y, -c.z); else model.position.y = -box.min.y;
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.itemId = itemId; o.userData.room = room; } });
    holder.add(model); holder.updateMatrixWorld(true);
    if (p.blob !== false) { const wb = new THREE.Box3().setFromObject(holder); blob((wb.min.x + OX) * 100, (wb.min.z + OZ) * 100, (wb.max.x + OX) * 100, (wb.max.z + OZ) * 100, p.blob ?? .28); }
    const cm = [size.x * 100, size.z * 100, size.y * 100].map(v => Math.round(v * 10) / 10);
    const rec = { src: p.src, item: itemId || null, sizeCm: cm, scale: k };
    if (p.expect) { const tol = p.tolerance ?? 0.03; rec.expectCm = p.expect; rec.deviation = cm.map((v, i) => Math.round((v / p.expect[i] - 1) * 1000) / 10); rec.ok = rec.deviation.every(d => Math.abs(d) <= tol * 100); }
    GLB.report.push(rec); GLB.loaded.push(holder);
    if (typeof onGlbLoaded === 'function') onGlbLoaded(holder);
    GLB.waiting--; glbSettled();
  }, err => { GLB.errors.push(p.src + ': ' + (err?.message || err)); GLB.waiting--; glbSettled(); });
  planSymbol({ kind: 'bounds', category: p.category || 'seat', obj: holder });
  return holder;
};

/* ---------- прямоугольный стол на двух опорах (переговорный, обеденный) ---------- */
// rect — столешница; опоры-панели на отступе legInset от торцов, царга между ними. Как стол C10 эталона.
CATALOG.meetingTable = p => {
  const [x0, y0, x1, y1] = p.rect, h = p.h ?? 75, ins = p.legInset ?? 40, mat = matByName(p.mat, MAT.furn), leg = matByName(p.legMat, mat);
  RB(mat, x0, y0, x1, y1, h - 4, h, p.r ?? 1);
  if ((x1 - x0) >= (y1 - y0)) { const cy = (y0 + y1) / 2; B(leg, x0 + ins, cy - 20, x0 + ins + 12, cy + 20, 0, h - 4); B(leg, x1 - ins - 12, cy - 20, x1 - ins, cy + 20, 0, h - 4); B(leg, x0 + ins + 12, cy - 3, x1 - ins - 12, cy + 3, 10, 60); }
  else { const cx = (x0 + x1) / 2; B(leg, cx - 20, y0 + ins, cx + 20, y0 + ins + 12, 0, h - 4); B(leg, cx - 20, y1 - ins - 12, cx + 20, y1 - ins, 0, h - 4); B(leg, cx - 3, y0 + ins + 12, cx + 3, y1 - ins - 12, 10, 60); }
  blob(x0, y0, x1, y1, .35);
};
/* ---------- напольная вешалка ---------- */
CATALOG.coatRack = p => {
  const [x, y] = p.at, h = p.h ?? 180;
  CYL(MAT.metal, x, y, 18, 0, 1.6, 32); CYL(MAT.metal, x, y, 1.6, 1.6, h, 16); CYL(MAT.metal, x, y, 2.4, h - 1, h + 1.5, 16);
  const g = new THREE.Group(); g.position.set(WX(x), 0, WZ(y)); G.interior.add(g);
  for (let i = 0; i < (p.hooks ?? 6); i++) { const a = i * Math.PI * 2 / (p.hooks ?? 6); for (const [hh, len] of [[h - 6, .14], [h - 22, .10]]) {
    tube([[0, hh * S, 0], [Math.cos(a) * len * .6, (hh + 3) * S, Math.sin(a) * len * .6], [Math.cos(a) * len, (hh + 8) * S, Math.sin(a) * len]], .006, MAT.metal, g); } }
  blob(x - 22, y - 22, x + 22, y + 22, .25); planSymbol({ kind: 'circle', c: [x, y], r: 18 });
};
