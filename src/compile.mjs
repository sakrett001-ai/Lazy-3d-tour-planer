import {packageProject, assertProject, catalogItem, bounds, itemBounds, fixturePosition, polygonArea, clone} from './project.mjs';
import {inspectGLB} from './glb.mjs';

export const scriptJSON=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export const htmlText=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeScript=x=>x.replace(/<\/script/gi,'<\\/script');
export function engineProject(input){
 const p=assertProject(input),b=bounds(p),origin=[(b[0]+b[2])/2,(b[1]+b[3])/2],height=Math.max(...p.walls.map(w=>w.height));
 const rooms=p.rooms.map(r=>{const xs=r.polygon.map(p=>p[0]),ys=r.polygon.map(p=>p[1]),rect=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];return{id:r.id,name:r.name,rect,eye:[(rect[0]+rect[2])/2,(rect[1]+rect[3])/2],look:[(rect[0]+rect[2])/2,rect[1]],planName:r.name}});
 return{schema:'interiors-engine/1',units:'cm',meta:{id:p.meta.id,title:p.meta.name,heading:'Lazy 3D',loading:'Подготавливаем пространство…',storageKey:'lazy-preview-'+p.meta.id},origin,ceiling:height,start:rooms[0].id,
  walls:p.walls.map(w=>({id:w.id,a:w.a,b:w.b,t:w.thickness,H:w.height,mat:'lazy_'+w.material,sides:[],noSkirt:true,ops:w.openings.map(o=>({type:o.type,s:o.offset,e:o.offset+o.width,sill:o.sill,head:o.sill+o.height})),windows:{inSide:1,sill:'whiteMatte',transom:false}})),
  floors:p.rooms.map(r=>({poly:r.polygon,mat:'lazy_'+r.material,main:false})),ceilings:p.rooms.map(r=>({poly:r.polygon,mat:'ceiling',h:height})),
  doors:p.walls.flatMap(w=>w.openings.filter(o=>o.type==='door').map((o,i)=>({wall:w.id,op:i,hinge:o.hinge||'s',swing:o.swing||1,angle:90,mat:'doorLeaf',open:false,casing:[1,-1]}))),rooms,
  items:p.instances.map(it=>{const def=catalogItem(p,it.assetId);return{id:it.id,room:rooms[0].id,label:def.name,type:'plannerItem',rect:itemBounds(p,it),collision:true,at:[it.x,it.y],z:it.z,rot:it.rotation,definition:def}}),
  lights:p.fixtures.map(f=>({...f,type:'plannerFixture',at:fixturePosition(p,f)})),exterior:{type:'none'},
  planner:{materials:p.materials,walls:p.walls,fixtures:p.fixtures,lighting:p.lighting,version:1},finishes:{defaults:{lighting:p.lighting.preset}},checks:{radiusCm:22,gridCm:10}
 };
}
export function createTourHTML(input,bundle){
 const p=packageProject(input),ep=engineProject(p),models={},textures={};
 for(const [id,a] of Object.entries(p.assets)){if(a.mime==='model/gltf-binary'){inspectGLB(a.data);models[id]=a.data}else textures[id]='data:'+a.mime+';base64,'+a.data}
 const reportError=`addEventListener('error',e=>{const el=document.getElementById('loading');if(el){el.textContent='3D не запустился: '+e.message+'. План доступен в соседней вкладке.';el.classList.remove('done');}parent.postMessage({type:'lazy-render-error',message:e.message},'*');});`;
 const finish=`
if(!window.LAZY_TEXTURE_REQUESTS){texReady=true;document.getElementById('loading').classList.add('done');}
document.getElementById('help').hidden=true;
window.TOUR.setMode('orbit');window.TOUR.setLighting(PROJECT.planner.lighting.preset);
window.TOUR.scene=scene;window.TOUR.renderer=renderer;window.TOUR.camera=camera;
window.TOUR.snapshot=()=>({mode,orbit:{...orbit},walk:{...walk}});
window.TOUR.restore=s=>{if(s?.orbit)Object.assign(orbit,s.orbit);if(s?.walk)Object.assign(walk,s.walk);if(s?.mode)setMode(s.mode);dirty=true;};
parent.postMessage({type:'lazy-render-ready',items:PROJECT_ITEMS.length},'*');
`;
 const blocks=[`<script>${reportError}</script>`,`<script id="three-js">${safeScript(bundle.three)}</script>`,
  ...(Object.keys(models).length?[`<script id="gltf-addons">${safeScript(bundle.gltf)}</script>`]:[]),
  `<script id="tour-assets">window.TOUR_ASSETS=${scriptJSON(models)};</script>`,
  `<script id="tour-textures">window.TOUR_TEX=${scriptJSON(textures)};window.TOUR_TEXTURE_POLICY='subset';</script>`,
  `<script id="tour-project">window.TOUR_PROJECT=${scriptJSON(ep)};</script>`,
  `<script id="tour-engine">${safeScript(bundle.head+'\n'+bundle.catalog+'\n'+bundle.extensions+'\n'+bundle.tail+'\n'+finish)}</script>`];
 let html=bundle.shell;for(const [k,v]of Object.entries({TITLE:p.meta.name,LOADING:'Подготавливаем пространство…',MARK:'L',KICKER:'Lazy 3D',HEADING:p.meta.name,PROJECT_TITLE:p.meta.name,HELP_TITLE:'Прогулка',HELP_GO:'Войти',HELP_EXTRA:''}))html=html.split('{{'+k+'}}').join(htmlText(v));
 html=html.replace('</head>','<style>#loading.done{display:none!important}#title,#panelBtn,#captureBtn,#panel{display:none!important}#top{justify-content:flex-end}#rooms{bottom:8px}#roomName{display:none}#help{display:none!important}</style></head>');
 return html.split('{{SCRIPTS}}').join(blocks.join('\n'));
}
export function createOfflineHTML(input,bundle,app){
 const p=packageProject(input);for(const a of Object.values(p.assets))if(a.mime==='model/gltf-binary')inspectGLB(a.data);
 const classic=s=>s.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
 const code=[classic(app.domain),classic(app.glb),classic(app.compiler),classic(app.js)].join('\n');
 const embed={project:p,bundle,app};
 const policy=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; frame-src blob:; child-src blob:; connect-src 'none'; font-src data:;">`;
 let html=app.html.replace('<link rel="stylesheet" href="/app/style.css">',()=>'<style>'+app.css+'</style>');
 html=html.replace('<script type="module" src="/app/app.mjs"></script>',()=>`<script>window.LAZY_EMBED=${scriptJSON(embed)};</script><script>${safeScript(code)}</script>`);
 return html.replace('</head>',policy+'</head>');
}
