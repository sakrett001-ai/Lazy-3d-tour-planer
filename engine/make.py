#!/usr/bin/env python3
"""Полный выпуск проекта одной командой: тур → выгрузка → проверки → виды → план и буклет → манифест.

    python3 make.py <папка проекта> [--steps build,export,check,views,docs] [--only-views R1,C2] [--out <папка>]
    дополнительные шаги: six (листы шести видов, --items C01,R08), photo (Blender/Cycles, --size 1280x800 --samples 40)
    --photo-docs — собрать буклет из images-cycles без повторного рендера

Без --steps выполняются build,export,check,views,docs. Результаты — в <проект>/out: тур HTML, PDF плана и буклета, SVG плана,
data/ (model.json, layout.json, routes.json, verification.json), images/ (виды), manifest.json (размеры и SHA-256).
Код выхода 1 — сборка не удалась или проверки нашли замечания (выпуск при этом продолжается, отчёт сохраняется).
"""
import hashlib, json, subprocess, sys, time
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
args = sys.argv[1:]
project = Path(args[0]).resolve()
steps = (args[args.index('--steps') + 1].split(',') if '--steps' in args else ['build', 'export', 'check', 'views', 'docs'])
out = Path(args[args.index('--out') + 1]).resolve() if '--out' in args else project / 'out'
meta = json.loads((project / 'project.json').read_text(encoding='utf-8')).get('meta', {})
tour = out / f"{meta.get('id', 'interior')}-tour.html"
status = 0


def run(title, cmd):
    global status
    t0 = time.time(); print(f'▸ {title}', flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=ENGINE, text=True, capture_output=True)
    text = (r.stdout + r.stderr).strip()
    if text: print('  ' + text.replace('\n', '\n  '))
    print(f'  {time.time() - t0:.1f} с', flush=True)
    if r.returncode: status = 1
    return r.returncode


if 'build' in steps and run('сборка тура', ['node', 'build.mjs', project, '--out', tour]): sys.exit(1)
if 'export' in steps and run('выгрузка геометрии', ['node', 'tools/export.cjs', tour, '--out', out / 'data']):
    print('Выгрузка не удалась — дальнейшие шаги остановлены, чтобы не проверять устаревшие данные.'); sys.exit(1)
if 'check' in steps: run('проверки: расстановка, проходы, механизмы', [sys.executable, 'tools/verify.py', out / 'data', '--html', tour])
if 'views' in steps:
    cmd = [sys.executable, 'tools/views.py', tour, '--out', out / 'images']
    if '--only-views' in args: cmd += ['--only', args[args.index('--only-views') + 1]]
    run('виды для буклета', cmd)
if 'six' in steps:
    cmd = [sys.executable, 'tools/sixviews.py', tour, '--data', out / 'data', '--out', out / 'sixviews']
    if '--items' in args: cmd += ['--items', args[args.index('--items') + 1]]
    run('листы шести видов', cmd)
if 'photo' in steps:
    cmd = [sys.executable, 'tools/photoreal.py', tour, '--out', out / 'images-cycles']
    for flag in ('--size', '--samples'):
        if flag in args: cmd += [flag, args[args.index(flag) + 1]]
    if '--only-views' in args: cmd += ['--views', args[args.index('--only-views') + 1]]
    run('фотореалистичные виды (Blender/Cycles)', cmd)
images = out / ('images-cycles' if 'photo' in steps or '--photo-docs' in args else 'images')
if 'docs' in steps and not (images.exists() and any(images.glob('*.jpg'))):
    print(f'  внимание: в {images.name} нет видов — в буклете будут заглушки; сначала шаг views (или photo)')
if 'docs' in steps: run('план и буклет', [sys.executable, 'tools/documents.py', out / 'data', '--images', images, '--out', out])

manifest = {}
for f in sorted(out.rglob('*')):
    if f.is_file() and f.name != 'manifest.json' and f.suffix in ('.html', '.pdf', '.svg', '.json'):
        manifest[str(f.relative_to(out))] = {'bytes': f.stat().st_size, 'sha256': hashlib.sha256(f.read_bytes()).hexdigest()}
(out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf-8')
print(f'Готово: {out}' + ('' if status == 0 else ' — есть замечания, см. вывод выше'))
sys.exit(status)
