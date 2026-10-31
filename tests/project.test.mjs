import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject, packageProject, applyAction, itemBounds} from '../src/project.mjs';
import fs from 'node:fs';
const sample=()=>JSON.parse(fs.readFileSync(new URL('../examples/studio.json',import.meta.url),'utf8'));

test('дверь обязана помещаться в стене; перекрытие проёмов отклоняется',()=>{
 const p=sample(); const w=p.walls[0];
 w.openings=[{id:'bad',type:'door',offset:550,width:100,sill:0,height:210}];
 assert.ok(validateProject(p).some(e=>e.includes('проём')));
 w.openings=[{id:'a',type:'window',offset:100,width:140,sill:90,height:140},{id:'b',type:'door',offset:200,width:90,sill:0,height:210}];
 assert.ok(validateProject(p).some(e=>e.includes('перекры')));
});
test('пакет сохраняет выбранные каталоги и зависимости, исключает лишние',()=>{
 const p=sample();p.selection.items=['desk-oak'];p.instances=[];
 p.catalogs[0].items.push({id:'private-object',name:'Не передавать',kind:'glb',size:[50,50,50],model:'secret',material:'wood'});
 p.assets.secret={mime:'model/gltf-binary',data:'U0VDUkVU'};
 p.assets.unused={mime:'image/png',data:'U0VDUkVU'};
 const q=packageProject(p);
 assert.deepEqual(q.catalogs.flatMap(c=>c.items.map(i=>i.id)),['desk-oak']);
 assert.ok(q.materials.some(m=>m.id==='wood'));
 assert.equal(q.assets.secret,undefined);assert.equal(q.assets.unused,undefined);
 assert.equal(q.mode,'recipient');assert.equal(p.mode,'author');
});
test('получатель может двигать мебель, но не менять архитектуру',()=>{
 const p=packageProject(sample());
 assert.throws(()=>applyAction(p,{type:'wall.update',id:'north',patch:{height:900}}),/автор/);
 const q=applyAction(p,{type:'instance.update',id:'desk-1',patch:{x:250,rotation:90}});
 assert.equal(q.instances.find(i=>i.id==='desk-1').x,250);
 assert.equal(p.instances.find(i=>i.id==='desk-1').x,170);
});
test('нельзя добавлять изделие вне переданного каталога',()=>{
 const p=packageProject(sample());
 assert.throws(()=>applyAction(p,{type:'instance.add',assetId:'unknown',x:100,y:100}),/каталог/);
});
test('поворот мебели меняет габарит плана без изменения размера изделия',()=>{
 const p=sample(),it=p.instances[0];it.rotation=90;
 const b=itemBounds(p,it);assert.equal(Math.round(b[2]-b[0]),80);assert.equal(Math.round(b[3]-b[1]),160);
});
test('неизвестная структура импорта возвращает ошибки, а не исключение',()=>{
 for(const x of [null,[],{walls:17},{schema:'lazy-tour/1',walls:[null]}])assert.ok(validateProject(x).length);
});
test('удаление стены убирает привязанные проёмы и точки подключения',()=>{
 const p=sample();p.fixtures.push({id:'socket-wall',kind:'socket',wallId:'north',offset:30,side:1,height:30});
 const q=applyAction(p,{type:'wall.delete',id:'north'});
 assert.ok(!q.walls.some(w=>w.id==='north'));assert.ok(!q.fixtures.some(f=>f.id==='socket-wall'));
});
