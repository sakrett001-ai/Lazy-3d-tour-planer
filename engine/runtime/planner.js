/* Lazy planner adapter. Authored procedural PBR, catalogue instances and fixtures.
   All dimensions below are derived from the project's centimetres/millimetres. */
function plannerKelvin(k){
 const t=k/100,clamp=v=>Math.max(0,Math.min(255,v))/255;
 const r=t<=66?255:329.698727446*Math.pow(t-60,-.1332047592);
 const g=t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-.0755148492);
 const b=t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307;
 return new THREE.Color().setRGB(clamp(r),clamp(g),clamp(b),THREE.SRGBColorSpace);
}
function plannerMaps(m){
 const n=256,h=new Float32Array(n*n),color=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),rough=new Uint8Array(n*n*4);
 const noise=(x,y)=>{const a=Math.sin(x*127.1+y*311.7+17)*43758.5453;return a-Math.floor(a)};
 const smooth=t=>t*t*(3-2*t);
 const periodic=(u,v,cells)=>{const X=u*cells,Y=v*cells,x=Math.floor(X),y=Math.floor(Y),a=smooth(X-x),b=smooth(Y-y),at=(i,j)=>noise((i+cells)%cells,(j+cells)%cells);return(1-b)*((1-a)*at(x,y)+a*at(x+1,y))+b*((1-a)*at(x,y+1)+a*at(x+1,y+1))};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const u=x/n,v=y/n,grain=periodic(u,v,64),wave=(q,c)=>.5+.5*Math.cos(q*c*Math.PI*2);let value=.5;
  if(m.kind==='plaster')value=.6*periodic(u,v,24)+.3*grain+.1*periodic(u,v,4);
  if(m.kind==='wood')value=.55*wave(u+.012*Math.sin(v*Math.PI*2),36)+.25*wave(u,96)+.2*grain;
  if(m.kind==='leather'){const X=u*48,Y=v*48,ix=Math.floor(X),iy=Math.floor(Y);let a=10,b=10;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const gx=ix+i,gy=iy+j,px=gx+.18+.64*noise((gx+48)%48,(gy+48)%48),py=gy+.18+.64*noise((gy+48)%48+72,(gx+48)%48);const d=Math.hypot(X-px,Y-py);if(d<a){b=a;a=d}else if(d<b)b=d}value=Math.min(1,(b-a)*4)*.85+grain*.15}
  if(m.kind==='weave'){const count=32,ix=Math.floor(u*count),iy=Math.floor(v*count),fx=(u*count)%1,fy=(v*count)%1;const over=(ix+iy)%2;const warp=Math.pow(Math.sin(Math.PI*fx),.7),weft=Math.pow(Math.sin(Math.PI*fy),.7);value=(over?.72*warp+.18*weft:.72*weft+.18*warp)+grain*.1}
  if(m.kind==='fluted'){const f=(u*8)%1;value=f<.18?0:f>.82?0:Math.sin((f-.18)/.64*Math.PI)*.3+.7}
  if(m.kind==='brick'){const row=Math.floor(v*8),fx=(u*2+(row%2)*.5)%1,fy=(v*8)%1;const mortar=fx<.028||fx>.972||fy<.045||fy>.955;value=mortar?.05:.85+.15*grain}
  h[y*n+x]=value;
 }
 const scale=m.reliefMm/1000*n/(m.scaleCm/100),at=(x,y)=>h[((y+n)%n)*n+(x+n)%n];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const i=(y*n+x)*4,v=h[y*n+x],variation=m.kind==='brick'?(.88+.12*v):(.97+.03*v);
  color.set([255*variation,255*variation,255*variation,255],i);
  const dx=-(at(x+1,y)-at(x-1,y))*scale/2,dy=-(at(x,y+1)-at(x,y-1))*scale/2,l=Math.hypot(dx,dy,1);
  normal.set([Math.round((dx/l*.5+.5)*255),Math.round((dy/l*.5+.5)*255),Math.round((1/l*.5+.5)*255),255],i);
  const r=Math.round(255*(.92+.08*(1-v)));rough.set([r,r,r,255],i);
 }
 const tex=(data,srgb)=>{const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(100/m.scaleCm,100/m.scaleCm);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=Math.min(8,maxAniso);t.needsUpdate=true;return t};
 return{map:tex(color,true),normalMap:tex(normal,false),roughnessMap:tex(rough,false)};
}
if(PROJECT.planner){
 for(const m of PROJECT.planner.materials){const maps=plannerMaps(m);for(const [source,target,data] of [['texture','map',false],['normal','normalMap',true],['roughnessMap','roughnessMap',true]])if(m[source]){maps[target].dispose();maps[target]=tex(m[source],{rx:100/m.scaleCm,ry:100/m.scaleCm,data})}
  MAT['lazy_'+m.id]=std({...maps,color:m.color,roughness:m.roughness,metalness:0,normalScale:new V2(1,1),envMapIntensity:.55});
 }
}
CATALOG.plannerItem=p=>{
 const d=p.definition,[w,depth,h]=d.size;
 if(d.kind==='glb')return CATALOG.glb({src:d.model,at:p.at,y:p.z,rot:-p.rot,expect:d.size,blob:false,name:d.name});
 const before=new Set(G.interior.children),beforeSymbols=PLAN_SYMBOLS.length;
 const saved={furn:MAT.furn,leather:MAT.leather,sofa:MAT.sofa,sofaDark:MAT.sofaDark,front:MAT.front};
 const mat=MAT['lazy_'+d.material];Object.assign(MAT,{furn:mat,leather:mat,sofa:mat,sofaDark:mat,front:mat});
 try{
  if(d.kind==='desk')CATALOG.desk({rect:[-w/2,-depth/2,w/2,depth/2],h,pedestals:false,inlay:false});
  if(d.kind==='table')CATALOG.meetingTable({rect:[-w/2,-depth/2,w/2,depth/2],h,mat:'lazy_'+d.material});
  if(d.kind==='chair')CATALOG.officeChair({at:[0,0],kind:'task',plan:false});
  if(d.kind==='sofa')CATALOG.sofa({rect:[-w/2,-depth/2,w/2,depth/2],facing:'S',mat:'lazy_'+d.material});
  if(d.kind==='roundTable')CATALOG.roundSideTable({at:[0,0],d:w,h});
  if(d.kind==='plant')CATALOG.plant({at:[0,0],k:1});
  if(d.kind==='cabinet')CATALOG.cabinet({at:[-w/2,-depth/2],W:w,D:depth,h:[0,h],body:'lazy_'+d.material,shelves:[[0,w,h/2]],doors:[{type:'L',u0:0,u1:w/2,y0:5,y1:h,mat:'lazy_'+d.material},{type:'R',u0:w/2,u1:w,y0:5,y1:h,mat:'lazy_'+d.material}]});
 }finally{Object.assign(MAT,saved)}
 const children=G.interior.children.filter(o=>!before.has(o)),g=new THREE.Group();g.position.set(WX(0),0,WZ(0));G.interior.add(g);g.updateMatrixWorld(true);
 for(const o of children){if(o.userData.blob){G.interior.remove(o);continue}g.attach(o)}
 g.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(g),sz=b.getSize(new V3());
 const shift=b.getCenter(new V3()).sub(g.position);shift.y=b.min.y;
 for(const o of g.children)o.position.sub(shift);
 // Rigid catalogue sizes are authoritative; normalize the procedural stand-in.
 if(sz.x&&sz.y&&sz.z)g.scale.set(w*.01/sz.x,h*.01/sz.y,depth*.01/sz.z);
 g.position.set(WX(p.at[0]),p.z*.01,WZ(p.at[1]));g.rotation.y=-p.rot*Math.PI/180;
 if(CURRENT_ITEM)CURRENT_ITEM.plan=[];PLAN_SYMBOLS.splice(beforeSymbols);planSymbol({kind:'bounds',category:d.kind==='chair'||d.kind==='sofa'?'seat':'furniture',obj:g});
 return g;
};
CATALOG.plannerFixture=p=>{
 const g=new THREE.Group();g.position.set(WX(p.at[0]),p.height*S,WZ(p.at[1]));g.rotation.y=-(p.rotation||0)*Math.PI/180;
 if(p.wallId){const w=PROJECT.planner.walls.find(w=>w.id===p.wallId);g.rotation.y=-Math.atan2(w.b[1]-w.a[1],w.b[0]-w.a[0])+(p.side===-1?Math.PI:0)}
 const mesh=(geo,mat,x=0,y=0,z=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m};
 if(p.kind==='socket'||p.kind==='switch'){
  mesh(new THREE.BoxGeometry(.085,.085,.012),MAT.whiteMatte);
  if(p.kind==='switch')mesh(new THREE.BoxGeometry(.05,.05,.009),MAT.whiteLac,0,0,.01);
  else for(const x of [-.014,.014]){const hole=mesh(new THREE.CylinderGeometry(.006,.006,.003,12),MAT.blackGlass,x,0,.008);hole.rotation.x=Math.PI/2}
  G.interior.add(g);return g;
 }
 const shade=std({color:0xf5f2e9,roughness:.8,emissive:plannerKelvin(p.temperature),emissiveIntensity:.2});
 if(p.kind==='panel'){mesh(new THREE.BoxGeometry(p.width*S,.035,p.depth*S),MAT.whiteMatte);mesh(new THREE.BoxGeometry(p.width*S*.96,.006,p.depth*S*.96),shade,0,-.02,0)}
 else{mesh(new THREE.CylinderGeometry(.07,.07,.035,20),MAT.whiteMatte);mesh(new THREE.CylinderGeometry(.055,.055,.006,20),shade,0,-.02,0)}
 G.ceiling.add(g);
 const L=beam(p.at[0],p.at[1],p.height*S-.04,p.kind==='panel'?'panel':'down',plannerKelvin(p.temperature),p.kind==='panel'?1.05:.65,true);
 const entry=LAMPS[LAMPS.length-1];entry.planner={power:p.power,temperature:p.temperature,shade};return g;
};
function applyPlannerLighting(name){
 if(!PROJECT.planner)return;const cfg=PROJECT.planner.lighting;
 sun.color.copy(plannerKelvin(cfg.naturalTemperature));sun.intensity*=cfg.naturalPower;
 renderer.toneMappingExposure=cfg.exposure;
 for(const l of LAMPS)if(l.planner){l.L.color.copy(plannerKelvin(l.planner.temperature));l.L.intensity=l.planner.power*LIGHT_MODES[name].lamps;l.planner.shade.emissiveIntensity=l.L.intensity>0?.25:0}
}
function plannerEnvironment(es){
 const bb=PROJECT.walls.flatMap(w=>[w.a,w.b]),minX=Math.min(...bb.map(p=>p[0])),maxX=Math.max(...bb.map(p=>p[0])),minY=Math.min(...bb.map(p=>p[1])),maxY=Math.max(...bb.map(p=>p[1]));
 const room=new THREE.Mesh(new THREE.BoxGeometry((maxX-minX)*S,HC*S,(maxY-minY)*S),new THREE.MeshBasicMaterial({color:0x787872,side:THREE.BackSide}));room.position.set(WX((minX+maxX)/2),HC*S/2,WZ((minY+maxY)/2));es.add(room);
 for(const w of PROJECT.walls)for(const o of w.ops.filter(o=>o.type==='window')){const L=Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]),u=(o.s+o.e)/2/L,x=w.a[0]+(w.b[0]-w.a[0])*u,y=w.a[1]+(w.b[1]-w.a[1])*u;const m=new THREE.Mesh(new THREE.PlaneGeometry((o.e-o.s)*S,(o.head-o.sill)*S),new THREE.MeshBasicMaterial({color:plannerKelvin(PROJECT.planner.lighting.naturalTemperature).multiplyScalar(1.8*PROJECT.planner.lighting.naturalPower),side:THREE.DoubleSide}));m.position.set(WX(x),(o.sill+o.head)*S/2,WZ(y));m.rotation.y=-Math.atan2(w.b[1]-w.a[1],w.b[0]-w.a[0]);es.add(m)}
 for(const f of PROJECT.lights.filter(f=>f.kind==='panel'||f.kind==='spot')){const m=new THREE.Mesh(new THREE.PlaneGeometry((f.width||14)*S,(f.depth||14)*S),new THREE.MeshBasicMaterial({color:plannerKelvin(f.temperature).multiplyScalar(Math.min(2,f.power/10)),side:THREE.DoubleSide}));m.position.set(WX(f.at[0]),f.height*S,WZ(f.at[1]));m.rotation.x=Math.PI/2;es.add(m)}
}
function buildPlannerRelief(){
 if(!PROJECT.planner)return;let count=0;
 for(const def of PROJECT.planner.walls){const m=PROJECT.planner.materials.find(m=>m.id===def.material);if(m?.kind!=='fluted'||m.reliefMm<1)continue;const w=WALL_BY_ID[def.id],pitch=m.scaleCm/8,width=pitch*.64,depth=m.reliefMm/10,angle=-Math.atan2(w.b[1]-w.a[1],w.b[0]-w.a[0]);
  for(let u=pitch/2;u<w.L&&count<3000;u+=pitch){const cuts=def.openings.filter(o=>o.offset<u+width/2&&o.offset+o.width>u-width/2).map(o=>[o.sill,o.sill+o.height]);let spans=[[0,def.height]];for(const [a,b]of cuts)spans=spans.flatMap(([s,e])=>b<=s||a>=e?[[s,e]]:[[s,Math.max(s,a)],[Math.min(e,b),e]].filter(([x,y])=>y-x>1));for(const side of [-1,1])for(const [a,b]of spans){const pt=wp(w,u,side,depth/2);const mesh=new THREE.Mesh(new THREE.BoxGeometry(width*S,(b-a)*S,depth*S),MAT['lazy_'+m.id]);mesh.position.set(WX(pt[0]),(a+b)*S/2,WZ(pt[1]));mesh.rotation.y=angle;mesh.castShadow=mesh.receiveShadow=true;G.interior.add(mesh);count++}}
 }
}
