#!/usr/bin/env python3
"""Фотореалистичные виды проекта через Blender/Cycles: группирует виды по состоянию механизмов,
выгружает сцену тура для каждой группы и рендерит.

    python3 tools/photoreal.py <тур.html> --out <папка> [--views C1,C2] [--size 1280x800] [--samples 40] [-- доп. параметры cycles_render]

Python с bpy: переменная INTERIORS_BPY_PYTHON (например /root/asset-runtime/bin/python) или Blender CLI в
INTERIORS_BLENDER. Установка bpy: `uv venv --python 3.11 RUNTIME && uv pip install --python RUNTIME/bin/python bpy==4.5.3 pillow numpy`.
Время на CPU растёт с размером и числом сэмплов: 800×500/24 — около 1 мин на 2 ядрах, 1280×800/40 — около 5 мин.
"""
import json, os, subprocess, sys, tempfile, shutil, hashlib, math, signal
from pathlib import Path

class RenderInterrupted(RuntimeError):
    pass


def interrupted(signum, frame):
    raise RenderInterrupted(f'Render interrupted by signal {signum}')
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)

HERE = Path(__file__).resolve().parent
args = sys.argv[1:]
extra = args[args.index('--') + 1:] if '--' in args else []
args = args[:args.index('--')] if '--' in args else args
html = Path(args[0]).resolve()
out = Path(args[args.index('--out') + 1]).resolve()
size = args[args.index('--size') + 1] if '--size' in args else '1280x800'
samples = args[args.index('--samples') + 1] if '--samples' in args else '40'
only = set(args[args.index('--views') + 1].split(',')) if '--views' in args else None
py = os.environ.get('INTERIORS_BPY_PYTHON'); blender = os.environ.get('INTERIORS_BLENDER')
if not py and not blender:
    blender = shutil.which('blender')
if py and blender: sys.exit('Выберите один runtime: INTERIORS_BPY_PYTHON или INTERIORS_BLENDER')
if not py and not blender: sys.exit('Нет Blender: задайте INTERIORS_BPY_PYTHON (python с bpy) или INTERIORS_BLENDER (путь к blender)')
from PIL import Image
dimensions = tuple(int(x) for x in size.split('x'))
if len(dimensions) != 2 or min(dimensions) <= 0 or int(samples) <= 0: sys.exit('Размер и samples должны быть положительными')
allowed_extra = {'--sun', '--sky', '--lamp', '--emit', '--exposure'}
if len(extra) % 2 or any(extra[i] not in allowed_extra for i in range(0, len(extra), 2)):
    sys.exit('После -- разрешены только параметры света --sun/--sky/--lamp/--emit/--exposure VALUE')
if any(not math.isfinite(float(x)) for x in extra[1::2]): sys.exit('Параметры света должны быть конечными числами')
timeout = float(args[args.index('--timeout') + 1]) if '--timeout' in args else 1800
if not math.isfinite(timeout) or timeout <= 0: sys.exit('Timeout должен быть положительным конечным числом')

# состояние вида = двери + список открытых механизмов + освещение
html_text = html.read_text(encoding='utf-8')
import re
proj = json.loads(re.search(r'<script id="tour-project">window.TOUR_PROJECT=(.*?);</script>', html_text, re.S).group(1))
defaults = proj.get('viewDefaults') or {}
all_ids = [v['id'] for v in proj.get('views', [])]
if len(set(all_ids)) != len(all_ids) or any(not re.fullmatch(r'[A-Za-z0-9_-]+', i) for i in all_ids): sys.exit('Некорректные или повторные ID видов')
if only is not None and (not only or only - set(all_ids)): sys.exit('Неизвестные или пустые --views')
groups = {}
for v in proj.get('views', []):
    if only and v['id'] not in only: continue
    state = json.dumps([v.get('doors', defaults.get('doors', 'open')), sorted(set((defaults.get('open') or []) + (v.get('open') or []))), v.get('lighting', defaults.get('lighting', 'day'))], ensure_ascii=False)
    groups.setdefault(state, []).append(v['id'])
if not groups: sys.exit('Нет видов для рендера')
out.mkdir(parents=True, exist_ok=True)
report = []
status_file = out / 'cycles-report.json'
def save_report(status, error=None):
    payload = {'status': status, 'renderer': 'Blender Cycles CPU', 'size': size, 'samples': int(samples),
               'source_sha256': hashlib.sha256(html.read_bytes()).hexdigest(),
               'requested_views': [i for ids in groups.values() for i in ids], 'views': report,
               'note': 'Иллюстративный свет; не светотехнический расчёт.', 'error': error}
    pending = out / '.cycles-report.tmp'; pending.write_text(json.dumps(payload, ensure_ascii=False, indent=2)); pending.replace(status_file)
def fail(message):
    save_report('failed', message); sys.exit(message)
def run_checked(cmd):
    child = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             start_new_session=(os.name == 'posix'))
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except BaseException:
        if child.poll() is None:
            if os.name == 'posix': os.killpg(child.pid, signal.SIGTERM)
            else: child.terminate()
        try: child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            if os.name == 'posix': os.killpg(child.pid, signal.SIGKILL)
            else: child.kill()
            child.communicate()
        raise
    r = subprocess.CompletedProcess(cmd, child.returncode, stdout, stderr)
    if r.returncode: fail('Команда не выполнена:\n' + (r.stderr + r.stdout)[-4000:])
    return r
save_report('running')
try:
    with tempfile.TemporaryDirectory(prefix='.cycles-', dir=out) as tmp:
        for k, (state, ids) in enumerate(groups.items()):
            sc = Path(tmp) / f'state{k}'
            run_checked(['node', str(HERE / 'scene-export.cjs'), str(html), '--out', str(sc), '--view', ids[0]])
            frames = Path(tmp) / f'frames{k}'
            cmd = ([py, str(HERE / 'cycles_render.py')] if py else [blender, '-b', '--python-exit-code', '1', '--python', str(HERE / 'cycles_render.py'), '--']) + \
                  [str(sc), '--views', ','.join(ids), '--out', str(frames), '--size', size, '--samples', samples] + extra
            r = run_checked(cmd)
            (out / f'cycles-group-{k}.log').write_text(r.stdout + r.stderr)
            verified = []
            for view in ids:
                found = [frames / (view + ext) for ext in ('.png', '.jpg') if (frames / (view + ext)).is_file()]
                if len(found) != 1: fail(f'{view}: не создан единственный новый кадр')
                try:
                    with Image.open(found[0]) as im:
                        im.load()
                        if im.size != dimensions or im.format not in ('PNG', 'JPEG'): raise ValueError('неверный формат или размер')
                except Exception as e: fail(f'{view}: повреждённый кадр: {e}')
                verified.append((view, found[0]))
            for view, file in verified:
                if any((out / (view + ext)).is_dir() for ext in ('.png', '.jpg')):
                    fail(f'{view}: output target is a directory')
            for view, file in verified:
                target = out / file.name; file.replace(target)
                row = {'view': view, 'file': target.name, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
                report.append(row); save_report('running')
                for ext in ('.png', '.jpg'):
                    alternate = out / (view + ext)
                    if alternate != target: alternate.unlink(missing_ok=True)
                print(json.dumps(row), flush=True)
            save_report('running')
    save_report('complete')
except (Exception, KeyboardInterrupt) as error:
    fail(str(error))

print(json.dumps({'out': str(out), 'views': len(report)}, ensure_ascii=False))
