// Rigid, self-contained GLB 2.0 import. External URLs and decoder-dependent assets
// are deliberately rejected: exported tours must remain offline.
export function inspectGLB(base64){
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),v=new DataView(bytes.buffer);
 if(bytes.length<20||v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==bytes.length)throw new Error('Нужен корректный GLB версии 2');
 if(bytes.length>30*1024*1024)throw new Error('Одна модель должна быть меньше 30 МБ');
 let json,bin;for(let at=12;at<bytes.length;){if(at+8>bytes.length)throw new Error('Обрезан заголовок GLB');const n=v.getUint32(at,true),t=v.getUint32(at+4,true);at+=8;if(at+n>bytes.length)throw new Error('Обрезан блок GLB');if(t===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(bytes.subarray(at,at+n)).trim());if(t===0x004e4942)bin=bytes.subarray(at,at+n);at+=n}
 if(!json||!bin||json.asset?.version!=='2.0')throw new Error('В GLB нет геометрии');
 if((json.extensionsRequired||[]).length)throw new Error('Экспортируйте GLB без обязательных расширений/Draco/Meshopt');
 for(const b of json.buffers||[])if(b.uri)throw new Error('Буферы GLB должны находиться внутри файла');
 for(const i of json.images||[])if(i.uri&&!/^data:image\/(png|jpeg);base64,/.test(i.uri))throw new Error('Внешние текстуры GLB не допускаются; упакуйте их в файл');
 if((json.skins||[]).length)throw new Error('Каталог мебели пока принимает статические GLB без скелета');
 const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const mul=(a,b)=>Array.from({length:16},(_,i)=>[0,1,2,3].reduce((s,k)=>s+a[(i%4)+k*4]*b[k+Math.floor(i/4)*4],0));
 function local(n){if(n.matrix)return n.matrix;const[x,y,z,w]=n.rotation||[0,0,0,1],[sx,sy,sz]=n.scale||[1,1,1],[tx,ty,tz]=n.translation||[0,0,0];return[(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,(2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,(2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,tx,ty,tz,1]}
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let vertices=0,triangles=0;
 const dv=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
 function visit(index,parent,parents){if(parents.has(index)||parents.size>100)throw new Error('Циклическая структура GLB');const n=json.nodes?.[index];if(!n)throw new Error('Некорректный узел GLB');const M=mul(parent,local(n));if(!M.every(Number.isFinite))throw new Error('Некорректное преобразование GLB');
  if(n.mesh!==undefined)for(const primitive of json.meshes?.[n.mesh]?.primitives||[]){
   if(primitive.extensions?.KHR_draco_mesh_compression)throw new Error('Draco требует отдельного декодера; экспортируйте несжатый GLB');
   const a=json.accessors?.[primitive.attributes?.POSITION],b=json.bufferViews?.[a?.bufferView];
   if(!a||a.type!=='VEC3'||a.componentType!==5126||a.sparse||!b||b.buffer!==0||b.extensions)throw new Error('Нужны обычные позиции VEC3/FLOAT без сжатия');
   if(!Number.isInteger(a.count)||a.count<1||vertices+a.count>1500000)throw new Error('Модель превышает 1,5 млн вершин');
   const stride=b.byteStride||12,start=(b.byteOffset||0)+(a.byteOffset||0);if(stride<12||start<0||start+(a.count-1)*stride+12>bin.byteLength)throw new Error('Повреждены координаты GLB');
   for(let k=0;k<a.count;k++){const at=start+k*stride,xyz=[dv.getFloat32(at,true),dv.getFloat32(at+4,true),dv.getFloat32(at+8,true)];for(let j=0;j<3;j++){const t=M[j]*xyz[0]+M[4+j]*xyz[1]+M[8+j]*xyz[2]+M[12+j];if(!Number.isFinite(t))throw new Error('Некорректная вершина GLB');min[j]=Math.min(min[j],t);max[j]=Math.max(max[j],t)}}vertices+=a.count;triangles+=(primitive.mode??4)===4?Math.floor((json.accessors?.[primitive.indices]?.count||a.count)/3):0;
  }
  const next=new Set(parents);next.add(index);for(const child of n.children||[])visit(child,M,next);
 }
 const roots=json.scenes?.[json.scene??0]?.nodes;if(!roots?.length)throw new Error('В GLB нет сцены');for(const n of roots)visit(n,I,new Set());
 const size=[max[0]-min[0],max[2]-min[2],max[1]-min[1]].map(n=>Math.round(n*10000)/100);
 if(!vertices||!size.every(n=>n>=1&&n<=5000))throw new Error('Проверьте единицы GLB: ожидаются метры и размер изделия 1–5000 см');
 return{size,vertices,triangles};
}
