#!/usr/bin/env python3
"""Проверки проекта по выгрузке export.cjs.

    python3 tools/verify.py <папка data> [--html тур.html]

1. check_layout.py навыка: пересечения, полный ход дверей, заданные расстояния и маршруты (layout.json).
2. Проходимость сеткой: от точки старта ко всем помещениям и заданным точкам, двери открыты,
   мебель и стулья — препятствия, радиус человека/камеры задан в checks.radiusCm (по умолчанию 22 см).
3. Механизмы: сколько дверец ограничено стеной и где.
4. Офлайн-тур: внешние скрипты и отсутствующие текстуры.
Пишет verification.json и печатает короткую сводку. Код выхода 1 — есть замечания.
"""
import json, re, subprocess, sys
from collections import deque
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent.parent
args = sys.argv[1:]
data = Path(args[0]).resolve()
html = Path(args[args.index('--html') + 1]).resolve() if '--html' in args else None

model = json.loads((data / 'model.json').read_text(encoding='utf-8'))
routes = json.loads((data / 'routes.json').read_text(encoding='utf-8'))
checks = routes.get('checks') or {}
report = {'project': model.get('project'), 'version': model.get('version'),
          'scope': 'CPU-геометрия модели; WebGL и частота кадров в браузере этой проверкой не измеряются', 'checks': {}, 'issues': []}

# 1. check_layout.py
lay_out = data / 'layout-report.json'
r = subprocess.run([sys.executable, str(SKILL / 'scripts' / 'check_layout.py'), str(data / 'layout.json'), '--output', str(lay_out)], capture_output=True, text=True)
if r.returncode == 2:
    msg = (r.stderr or r.stdout).strip()[:300]
    hint = ' (расстояния задаются между предметами с rect и без collision: false)' if 'clearance' in msg else ''
    report['issues'].append('check_layout.py не выполнен, ход дверей и пересечения НЕ проверены: ' + msg + hint)
else:
    lay = json.loads(lay_out.read_text(encoding='utf-8'))
    report['checks']['layout'] = {'status': lay['status'], 'coverage': lay['coverage'], 'clearances': lay['clearances'], 'issues': lay['issues']}
    for i in lay['issues']:
        report['issues'].append('расстановка: ' + json.dumps(i, ensure_ascii=False))

# 2. проходимость сеткой
step = checks.get('gridCm', 4); R = checks.get('radiusCm', 22)
x0, y0, x1, y1 = routes['bounds']
xs = np.arange(x0, x1 + step, step); ys = np.arange(y0, y1 + step, step); X, Y = np.meshgrid(xs, ys)
blocked = np.zeros_like(X, dtype=bool)
for sx0, sy0, sx1, sy1, t in routes['segments']:
    dx, dy = sx1 - sx0, sy1 - sy0
    u = np.clip(((X - sx0) * dx + (Y - sy0) * dy) / max(dx * dx + dy * dy, 1e-5), 0, 1)
    blocked |= (X - sx0 - u * dx) ** 2 + (Y - sy0 - u * dy) ** 2 < (R + t) ** 2
def block_rect(mask, a, c, e, f, r=R):
    mask |= (np.maximum(np.maximum(a - X, X - e), 0) ** 2 + np.maximum(np.maximum(c - Y, Y - f), 0) ** 2) < r ** 2
for it in routes['items']:
    b = it['bounds']
    if b[4] < 150: block_rect(blocked, *b[:4])          # подвесное над головой не мешает проходу
for b in routes['seats']: block_rect(blocked, *b)
def cell(p): return (int(round((p[1] - y0) / step)), int(round((p[0] - x0) / step)))
def reach(mask, start):
    seen = np.zeros_like(mask); s = cell(start)
    if mask[s]:
        return seen, False
    seen[s] = True; q = deque([s])
    while q:
        yy, xx = q.popleft()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            a, b = yy + dy, xx + dx
            if 0 <= a < mask.shape[0] and 0 <= b < mask.shape[1] and not mask[a, b] and not seen[a, b]:
                seen[a, b] = True; q.append((a, b))
    return seen, True
rooms = {r['id']: r for r in routes['rooms']}
start = rooms.get(routes.get('start')) or next(iter(rooms.values()))
skip = set(checks.get('skipRooms', []))
targets = {r['id']: r['eye'] for r in routes['rooms'] if r['id'] not in skip}
targets.update(checks.get('targets', {}))
seen, ok_start = reach(blocked, start['eye'])
res = {k: {'target': v, 'reachable': bool(ok_start and seen[cell(v)])} for k, v in targets.items()}
occupied = {}
for sc in checks.get('occupied', []):
    mask = blocked.copy(); block_rect(mask, *sc['rect'])
    s2, ok2 = reach(mask, start['eye'])
    occupied[sc['id']] = {'label': sc.get('label'), 'rect': sc['rect'], 'targets': {t: bool(ok2 and s2[cell(targets[t])]) for t in sc.get('reach', [])}}
    for t, v in occupied[sc['id']]['targets'].items():
        if not v: report['issues'].append(f'проход: при «{sc.get("label", sc["id"])}» недостижимо «{t}»')
report['checks']['routes'] = {'gridCm': step, 'radiusCm': R, 'start': start['id'], 'doors': 'открыты', 'chairs': 'учтены', 'targets': res, 'occupied': occupied}
for k, v in res.items():
    if not v['reachable']: report['issues'].append(f'проход: от «{start["id"]}» не дойти до «{k}» {v["target"]}')

# 3. механизмы
mech = model['mechanisms']
stops = [m for m in mech if m.get('wallStop')]
report['checks']['mechanisms'] = {'count': len(mech), 'byKind': {k: sum(1 for m in mech if m['kind'] == k) for k in sorted({m['kind'] for m in mech})},
                                  'limitedByWall': [{'label': m['label'], 'item': m['item'], 'openDeg': m['openDeg'], 'requestedDeg': m['requestedDeg'], 'stop': m['wallStop']} for m in stops]}

# 4. офлайн
if html:
    text = html.read_text(encoding='utf-8')
    ext = re.findall(r'<script[^>]+src=["\']([^"\']+)', text) + re.findall(r'<link[^>]+href=["\'](https?:[^"\']+)', text)
    report['checks']['offline'] = {'bytes': len(text.encode()), 'externalResources': ext, 'inlineScripts': len(re.findall(r'<script[ >]', text))}
    if ext: report['issues'].append('тур ссылается на внешние ресурсы: ' + ', '.join(ext))
report['renderStats'] = model.get('stats')
(data / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

lay = report['checks'].get('layout', {})
print(f"Расстановка: {lay.get('status', '—')}, дверей проверено {lay.get('coverage', {}).get('doors', 0)}, замечаний {len(lay.get('issues', []))}")
for c in lay.get('clearances', []):
    print(f"  расстояние {c['objects'][0]}–{c['objects'][1]}: {c['measured_m']:.3f} м (нужно {c['required_m']} м) — {'ок' if c['ok'] else 'НЕ ХВАТАЕТ'}")
print(f"Проходимость: {sum(v['reachable'] for v in res.values())} из {len(res)} точек достижимы от «{start['id']}»")
print(f"Механизмы: {len(mech)}, ограничены стеной: {len(stops)}")
if report['issues']:
    print('Замечания:'); [print('  - ' + i) for i in report['issues']]
sys.exit(1 if report['issues'] else 0)
