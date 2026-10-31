#!/usr/bin/env node
/**
 * Сборка интерьерного тура из данных проекта в один офлайн-HTML.
 *
 *   node build.mjs <папка проекта> [--out тур.html] [--all-textures]
 *
 * Папка проекта: project.json (обязательно), custom.js (свои изделия, необязательно),
 * textures/ (свои текстуры; перекрывают одноимённые текстуры движка).
 * Порядок кода в HTML: three.js → текстуры → данные проекта → ядро + каталог + custom.js + сборка сцены.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProject } from './tools/validate.mjs';

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1]; };
const projectDir = path.resolve(args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out') || '.');
const read = p => fs.readFileSync(p, 'utf8');

const projectFile = path.join(projectDir, 'project.json');
if (!fs.existsSync(projectFile)) { console.error('Не найден ' + projectFile); process.exit(2); }
const project = JSON.parse(read(projectFile));
const customFile = path.join(projectDir, 'custom.js');
const custom = fs.existsSync(customFile) ? read(customFile) : '';

const { errors: problems, warnings } = validateProject(project, custom);
if (warnings.length) console.error('Предупреждения по данным:\n- ' + warnings.join('\n- '));
if (problems.length) { console.error('Проект не прошёл проверку данных:\n- ' + problems.join('\n- ')); process.exit(1); }

const runtime = f => read(path.join(ENGINE, 'runtime', f));
const engine = [runtime('core-head.js'), runtime('catalog.js'), '/* ---------- custom.js проекта ---------- */\n' + custom, runtime('core-tail.js')].join('\n');

// Текстуры: только упомянутые в коде; фасады города — только если он включён.
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const textures = {};
for (const dir of [path.join(ENGINE, 'textures'), path.join(projectDir, 'textures')]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) { const ext = path.extname(f).toLowerCase(); if (MIME[ext]) textures[path.basename(f, ext)] = path.join(dir, f); }
}
const used = new Set([...engine.matchAll(/tex\('([A-Za-z0-9_]+)'/g)].map(m => m[1]));
if ((project.exterior?.type || 'none') === 'city') for (const k of Object.keys(textures)) if (k.startsWith('facade_')) used.add(k);
const embed = {}; const missing = [];
for (const key of [...used].sort()) {
  if (!textures[key] && !args.includes('--all-textures')) { missing.push(key); continue; }
  if (!textures[key]) continue;
  if (key.startsWith('facade_') && (project.exterior?.type || 'none') !== 'city') continue;
  embed[key] = `data:${MIME[path.extname(textures[key]).toLowerCase()]};base64,` + fs.readFileSync(textures[key]).toString('base64');
}

// Готовые 3D-модели (GLB): встраиваются целиком, загрузчик подключается только при их наличии.
const glbSrcs = [...new Set((project.items || []).flatMap(it => (it.parts || [it]).filter(q => q.type === 'glb').map(q => q.src)))];
const assets = {};
for (const src of glbSrcs) {
  const f = path.resolve(projectDir, src);
  if (!fs.existsSync(f)) { console.error('Нет файла модели: ' + f); process.exit(1); }
  assets[src] = fs.readFileSync(f).toString('base64');
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const m = project.meta || {};
const scripts = [
  `<script id="three-js">${safe(runtime('three.min.js'))}</script>`,
  ...(glbSrcs.length ? [`<script id="gltf-addons">${safe(runtime('gltf-addons.js'))}</script>`, `<script id="tour-assets">window.TOUR_ASSETS=${safe(JSON.stringify(assets))};</script>`] : []),
  `<script id="tour-textures">window.TOUR_TEX=${safe(JSON.stringify(embed))};</script>`,
  `<script id="tour-project">window.TOUR_PROJECT=${safe(JSON.stringify(project))};</script>`,
  `<script id="tour-engine">${safe(engine)}</script>`
].join('\n');
const fields = {
  TITLE: esc(m.pageTitle || `${m.title || 'Интерьер'} · Studio`), LOADING: esc(m.loading || 'Собираю интерьер…'), MARK: esc(m.mark || '◧'),
  KICKER: esc(m.kicker || `${m.title || 'Проект'} · интерьер`), HEADING: esc(m.heading || m.version || ''), PROJECT_TITLE: esc(m.title || 'Интерьер'),
  HELP_TITLE: esc(m.helpTitle || 'Прогулка по интерьеру'), HELP_GO: esc(m.helpGo || 'Войти'), HELP_EXTRA: m.helpExtra ? ' ' + esc(m.helpExtra) : ''
};
let html = runtime('shell.html');
for (const [k, v] of Object.entries(fields)) html = html.split(`{{${k}}}`).join(v);
html = html.split('{{SCRIPTS}}').join(scripts);   // split/join: no `$&` substitution surprises

const out = path.resolve(opt('--out', path.join(projectDir, 'out', (m.id || 'interior') + '-tour.html')));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(JSON.stringify({ file: out, bytes: Buffer.byteLength(html), textures: Object.keys(embed).length, missingTextures: missing,
  items: (project.items || []).length, models: glbSrcs.length, customJs: Boolean(custom) }));
