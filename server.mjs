import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertProject} from './src/project.mjs';
import {createOfflineHTML,createTourHTML} from './src/compile.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function runtimeBundle(){const files={three:'three.min.js',head:'core-head.js',catalog:'catalog.js',tail:'core-tail.js',shell:'shell.html',gltf:'gltf-addons.js',extensions:'planner.js'};return Object.fromEntries(await Promise.all(Object.entries(files).map(async([k,f])=>[k,await fs.readFile(path.join(root,'engine/runtime',f),'utf8')])))}
export async function appBundle(){const files={html:'app/index.html',css:'app/style.css',js:'app/app.mjs',domain:'src/project.mjs',compiler:'src/compile.mjs',glb:'src/glb.mjs'};return Object.fromEntries(await Promise.all(Object.entries(files).map(async([k,f])=>[k,await fs.readFile(path.join(root,f),'utf8')])))}
export function createServer(){
 const send=(res,code,body,type='application/json; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body))};
 return http.createServer(async(req,res)=>{try{
  const host=req.headers.host||'';if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))return send(res,403,{error:'Локальный редактор принимает запросы только с localhost'});
  if(req.method==='POST'&&req.headers.origin&&req.headers.origin!=='http://'+host)return send(res,403,{error:'Запрос с другого сайта отклонён'});
  const url=new URL(req.url,'http://'+host);
  if(req.method==='GET'&&url.pathname==='/api/bootstrap'){const [bundle,app,sample]=await Promise.all([runtimeBundle(),appBundle(),fs.readFile(path.join(root,'examples/studio.json'),'utf8')]);return send(res,200,{bundle,app,project:JSON.parse(sample)})}
  if(req.method==='POST'&&['/api/export','/api/preview'].includes(url.pathname)){
   if(!(req.headers['content-type']||'').startsWith('application/json'))return send(res,415,{error:'Нужен application/json'});
   let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>72*1024*1024){send(res,413,{error:'Проект превышает 72 МБ'});req.destroy();return}chunks.push(c)}
   const p=assertProject(JSON.parse(Buffer.concat(chunks).toString('utf8'))),bundle=await runtimeBundle();
   const html=url.pathname==='/api/export'?createOfflineHTML(p,bundle,await appBundle()):createTourHTML(p,bundle);
   return send(res,200,html,'text/html; charset=utf-8');
  }
  if(req.method!=='GET')return send(res,405,{error:'Метод недоступен'});
  let relative=url.pathname==='/'?'app/index.html':decodeURIComponent(url.pathname.slice(1));
  if(!/^(app|src)\/[a-zA-Z0-9_.-]+$/.test(relative))return send(res,404,{error:'Файл не найден'});
  const ext=path.extname(relative),mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'}[ext];
  if(!mime)return send(res,404,{error:'Файл не найден'});
  try{return send(res,200,await fs.readFile(path.join(root,relative)),mime)}catch{return send(res,404,{error:'Файл не найден'})}
 }catch(e){send(res,400,{error:e.message})}});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4173);createServer().listen(port,'127.0.0.1',()=>console.log('Lazy 3D Tour Planer → http://127.0.0.1:'+port));
}
