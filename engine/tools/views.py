#!/usr/bin/env python3
"""Снимки видов для буклета из самого тура: та же геометрия, материалы и свет, что видит пользователь.

    python3 tools/views.py <тур.html> --out <папка images> [--size 1600x1000] [--only R1,C2]

Виды берутся из project.views (встроены в HTML): eye/look [x, y, z] в см, fov, open (подписи механизмов
или id предметов, которые открыть), doors (open | closed | asis), lighting (day | work | sunset | evening).
Общие настройки — project.viewDefaults. Рендер: headless Chromium, WebGL через SwiftShader (CPU).
"""
import glob, json, sys, time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
html = Path(args[0]).resolve()
out = Path(args[args.index('--out') + 1]).resolve() if '--out' in args else html.parent / 'images'
w, h = (int(v) for v in (args[args.index('--size') + 1] if '--size' in args else '1600x1000').split('x'))
only = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
out.mkdir(parents=True, exist_ok=True)
chrome = (sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')) or [None])[-1]

with sync_playwright() as pw:
    launch = dict(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    if chrome: launch['executable_path'] = chrome
    b = pw.chromium.launch(**launch)
    page = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(html.as_uri())
    page.wait_for_function('window.TOUR && window.TOUR.ready === true', timeout=300000)
    views = page.evaluate('() => window.TOUR.PROJECT.views || []')
    defaults = page.evaluate('() => window.TOUR.PROJECT.viewDefaults || {}')
    done = []
    for v in views:
        if only and v['id'] not in only: continue
        spec = {**defaults, **v, 'open': list(dict.fromkeys((defaults.get('open') or []) + (v.get('open') or []))), 'aspect': w / h}
        t0 = time.time()
        page.evaluate('spec => window.TOUR.view(spec)', spec)
        page.wait_for_timeout(250)
        png = out / f"{v['id']}.png"
        page.locator('#stage canvas').screenshot(path=str(png))
        Image.open(png).convert('RGB').save(out / f"{v['id']}.jpg", quality=90, optimize=True)
        png.unlink()
        done.append({'id': v['id'], 'seconds': round(time.time() - t0, 1)})
        print(f"{v['id']}: {done[-1]['seconds']} с", flush=True)
    page.evaluate('() => window.TOUR.release()')
    b.close()
if errors:
    print('Ошибки страницы:', errors[:5]); sys.exit(1)
print(json.dumps({'out': str(out), 'views': len(done), 'size': f'{w}x{h}'}, ensure_ascii=False))
