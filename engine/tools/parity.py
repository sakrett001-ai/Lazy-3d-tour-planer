"""Сравнение двух сборок тура по снимкам всех помещений — проверка правок ядра движка.

    python3 tools/parity.py <тур-до.html> <тур-после.html> <папка снимков>

Для каждого помещения снимок из точки прогулки в обоих турах; среднее отличие и доля пикселей с отличием больше 24.
Совпадение — 0,00 и 0,00 %. Печатает число механизмов и счётчики отрисовки; рядом кладёт пары снимков.
"""
import json, sys, glob
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops, ImageStat

orig, new, outdir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
outdir.mkdir(parents=True, exist_ok=True)
chrome = sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome'))[-1]
HIDE = "#top,#rooms,#roomName,#hint,#joy,#help,#panel,#loading{display:none!important}"

def run(path, tag, page):
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text))
    page.goto('file://' + path)
    page.wait_for_function('window.OFFICE && window.OFFICE.ready === true', timeout=180000)
    page.add_style_tag(content=HIDE)
    info = page.evaluate("""() => { const O = window.OFFICE; return { rooms: O.ROOMS.map(r => r.id), toggles: O.TOG.length,
        labels: O.TOG.map(t => t.label), stats: window.TOUR ? window.TOUR.stats : null }; }""")
    shots = []
    for i, rid in enumerate(info['rooms']):
        page.evaluate(f"() => {{ window.OFFICE.go({i}); }}")
        page.wait_for_timeout(1500)
        p = outdir / f'{tag}-{i}-{rid}.png'
        page.screenshot(path=str(p))
        shots.append(p)
    return info, shots, errors

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=chrome, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    res = {}
    for tag, path in [('orig', orig), ('new', new)]:
        page = b.new_page(viewport={'width': 1200, 'height': 750})
        res[tag] = run(path, tag, page)
        page.close()
    b.close()

io, so, eo = res['orig']; inew, sn, en = res['new']
print('errors orig:', eo[:5]); print('errors new :', en[:5])
print('toggles', io['toggles'], inew['toggles'], 'stats new', inew['stats'])
lo, ln = sorted(io['labels']), sorted(inew['labels'])
if lo != ln:
    from collections import Counter
    print('label diff: only orig', list((Counter(lo) - Counter(ln)).elements())[:10], 'only new', list((Counter(ln) - Counter(lo)).elements())[:10])
for a, c in zip(so, sn):
    A, C = Image.open(a).convert('RGB'), Image.open(c).convert('RGB')
    d = ImageChops.difference(A, C)
    st = ImageStat.Stat(d.convert('L'))
    g = d.convert('L'); bad = sum(1 for v in (g.get_flattened_data() if hasattr(g, 'get_flattened_data') else g.getdata()) if v > 24) / (A.width * A.height)
    print(f'{a.name:32s} mean diff {st.mean[0]:.2f}  pixels>24: {bad*100:.2f}%')
    sheet = Image.new('RGB', (A.width * 2, A.height)); sheet.paste(A, (0, 0)); sheet.paste(C, (A.width, 0))
    sheet.resize((A.width, A.height // 2)).save(outdir / ('pair-' + a.name.replace('orig-', '')))
