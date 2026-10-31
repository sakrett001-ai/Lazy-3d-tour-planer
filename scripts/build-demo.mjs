import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimeBundle, appBundle } from '../server.mjs';
import { createOfflineHTML, createTourHTML, createStationHTML } from '../src/compile.mjs';
import { packageSummary } from '../src/project.mjs';
const p = JSON.parse(
  await fs.readFile(new URL('../examples/studio.json', import.meta.url), 'utf8'),
);
const [runtime, app] = await Promise.all([runtimeBundle(), appBundle()]);
const dir = new URL('../out/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const web = new URL('../web/', import.meta.url);
await fs.mkdir(web, { recursive: true });
await fs.writeFile(new URL('index.html', web), createStationHTML(p, runtime, app));
await fs.writeFile(new URL('.nojekyll', web), '');
await fs.writeFile(new URL('lazy-demo-tour.html', dir), createOfflineHTML(p, runtime, app));
await fs.writeFile(new URL('scene.html', dir), createTourHTML(p, runtime));
await fs.writeFile(
  new URL('package-summary.json', dir),
  JSON.stringify(packageSummary(p), null, 2),
);
console.log(JSON.stringify({ directory: dir.pathname, ...packageSummary(p) }));
