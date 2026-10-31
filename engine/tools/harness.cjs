/**
 * Запуск собранного тура в Node без браузера: настоящие конструкции Three.js на CPU,
 * WebGLRenderer, загрузчик текстур и PMREM заменены заглушками только здесь.
 * Код самого HTML такой замены не содержит.
 *
 *   const T = require('./harness.cjs').load('/abs/path/tour.html');
 *   T.PROJECT_ITEMS, T.TOG, T.WALLS, T.scene …
 */
const fs = require('fs'), vm = require('vm');

function scriptsOf(html) {
  const out = {};
  for (const m of html.matchAll(/<script id="([^"]+)">([\s\S]*?)<\/script>/g)) out[m[1]] = m[2].replace(/<\\\/script/gi, '</script');
  for (const id of ['three-js', 'tour-textures', 'tour-project', 'tour-engine']) if (!out[id]) throw new Error('В HTML нет блока <script id="' + id + '">: соберите тур через build.mjs');
  return out;
}

function load(htmlPath, opts = {}) {
  const S = scriptsOf(fs.readFileSync(htmlPath, 'utf8'));
  const noop = () => {};
  const ctx2d = new Proxy({ measureText: s => ({ width: String(s).length * 10 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) }, { get: (o, k) => (k in o ? o[k] : noop) });
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, children: [], hidden: false, clientWidth: 1920, clientHeight: 1200,
    width: 512, height: 256, appendChild(e) { this.children.push(e); }, addEventListener: noop, setAttribute: noop, querySelector: () => el(), querySelectorAll: () => [],
    getContext: () => ctx2d, getBoundingClientRect: () => ({ width: 1920, height: 1200, left: 0, top: 0 }), setPointerCapture: noop, releasePointerCapture: noop, click: noop, toBlob: noop });
  const elements = {};
  const quiet = { ...console, warn: (...a) => { if (!String(a[0]).includes('deprecated')) console.warn(...a); } };
  const sandbox = { console: quiet, performance: { now: () => 0 }, requestAnimationFrame: noop, ResizeObserver: class { observe() {} }, addEventListener: noop,
    setTimeout: noop, clearTimeout: noop, URL: {}, devicePixelRatio: 1, localStorage: { getItem: () => null, setItem: noop },
    document: { getElementById: id => (elements[id] ??= el()), createElement: el, querySelectorAll: () => [], body: el() }, Math: Object.create(Math) };
  let seed = 17391; sandbox.Math.random = () => ((seed = Math.imul(1664525, seed) + 1013904223 | 0) >>> 0) / 4294967296;
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.parent = { postMessage: noop };
  vm.createContext(sandbox);
  vm.runInContext(S['three-js'], sandbox, { filename: 'three.min.js' });
  const THREE = sandbox.THREE;
  class Renderer { constructor() { this.domElement = el(); this.capabilities = { getMaxAnisotropy: () => 8 }; this.shadowMap = {}; } setPixelRatio() {} setSize() {} render() {} }
  class Loader { load(url) { const t = new THREE.Texture(); t.userData.sourceUrl = opts.keepTextureUrls ? String(url) : String(url).slice(0, 32); return t; } }
  class PMREM { fromScene() { return { texture: new THREE.Texture() }; } dispose() {} }
  THREE.WebGLRenderer = Renderer; THREE.TextureLoader = Loader; THREE.PMREMGenerator = PMREM;
  // GLB: загрузчик из сборки; изображения текстур в Node заменяются заглушкой 1×1 — геометрия и габариты настоящие.
  if (S['gltf-addons']) {
    Object.assign(sandbox, { TextDecoder, TextEncoder, Blob, URL, atob, navigator: { userAgent: 'node' }, fetch: async () => { throw new Error('fetch недоступен в выгрузке'); }, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
    vm.runInContext(S['gltf-addons'], sandbox, { filename: 'gltf-addons.js' });
    THREE.ImageBitmapLoader.prototype.load = function (url, onLoad) { const bmp = { width: 1, height: 1, close() {} }; if (onLoad) onLoad(bmp); return bmp; };
    vm.runInContext(S['tour-assets'], sandbox);
  }
  vm.runInContext(S['tour-textures'], sandbox);
  vm.runInContext(S['tour-project'], sandbox);
  vm.runInContext(S['tour-engine'] + `
;globalThis.MODEL={scene,G,TOG,WALLS,PROJECT,PROJECT_ITEMS,PLAN_SYMBOLS,COLLIDERS,FITOUT,ROOMS,SEGS,CABINET_OBSTACLES,RENDER_STATS,PROJECT_BOUNDS,
  GLB,LAMPS,LIGHT_MODES,setLighting:typeof setLighting==='function'?setLighting:null,applyTog,collide,dynamicSegments,cabinetLeafLocalBounds,cabinetHitsWall,OX,OZ,S,WX,WZ,MAT,applyFinish,buildCabinetObstacles,floorOpenings,subtract,wp};`,
  sandbox, { filename: 'tour-engine.js', timeout: 60000 });
  return { THREE, ...sandbox.MODEL };
}

module.exports = { load, scriptsOf };
if (require.main === module) {
  const T = load(process.argv[2]);
  console.log(JSON.stringify({ items: T.PROJECT_ITEMS.length, toggles: T.TOG.length, stats: T.RENDER_STATS }));
}
