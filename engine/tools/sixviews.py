#!/usr/bin/env python3
"""Лист шести видов предмета — проверка достоверности по образцу anatomy (asset-fidelity).

    python3 tools/sixviews.py <тур.html> --data <папка data> [--items C01,R08] [--out <папка>] [--tile 520]

Предмет изолируется в туре (остальная сцена скрыта), снимаются виды с четырёх сторон плана, сверху
и общий. На листе — размеры по геометрии модели и, если у предмета есть паспорт (product в project.json
или expect у GLB), отклонение от паспортных размеров. Смотреть силуэт, число и место опор, крепления,
рабочие интерфейсы и фасады — отдельно от кинематики и отделки.
"""
import glob, json, math, sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

args = sys.argv[1:]
html = Path(args[0]).resolve()
data = Path(args[args.index('--data') + 1]).resolve() if '--data' in args else html.parent / 'data'
out = Path(args[args.index('--out') + 1]).resolve() if '--out' in args else html.parent / 'sixviews'
tile = int(args[args.index('--tile') + 1]) if '--tile' in args else 520
model = json.loads((data / 'model.json').read_text(encoding='utf-8'))
items = {i['id']: i for i in model['items'] if i.get('bounds')}
pick = args[args.index('--items') + 1].split(',') if '--items' in args else list(items)
out.mkdir(parents=True, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; FONTB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
f_title, f_text, f_small = ImageFont.truetype(FONTB, 22), ImageFont.truetype(FONT, 16), ImageFont.truetype(FONT, 14)
models = {m['item']: m for m in model.get('models', []) if m.get('item')}
chrome = (sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')) or [None])[-1]


def cameras(b, toward=None):
    x0, y0, x1, y1, z0, z1 = b
    c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]
    # общий вид — со стороны помещения (к центру комнаты), чтобы видеть рабочую сторону предмета
    sx, sy = .6, .62
    if toward:
        dx, dy = toward[0] - c[0], toward[1] - c[1]; L = math.hypot(dx, dy) or 1
        sx, sy = .62 * dx / L + .25 * (1 if dy >= 0 else -1) * abs(dx / L), .62 * dy / L + .25 * abs(dy / L)
    R = max(x1 - x0, y1 - y0, z1 - z0) / 2 * 1.25 + 5
    fov = 24; d = R / math.tan(math.radians(fov / 2))
    return fov, c, [
        ('со стороны +Y (низ плана)', [c[0], c[1] + d, c[2]]), ('со стороны −Y (верх плана)', [c[0], c[1] - d, c[2]]),
        ('со стороны +X (справа)', [c[0] + d, c[1], c[2]]), ('со стороны −X (слева)', [c[0] - d, c[1], c[2]]),
        ('сверху', [c[0], c[1], c[2] + d]), ('общий вид', [c[0] + d * sx, c[1] + d * sy, c[2] + d * .5])]


index = []
with sync_playwright() as pw:
    launch = dict(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    if chrome: launch['executable_path'] = chrome
    b = pw.chromium.launch(**launch)
    page = b.new_page(viewport={'width': tile, 'height': tile})
    page.goto(html.as_uri())
    page.wait_for_function('window.TOUR && window.TOUR.ready === true', timeout=300000)
    for iid in pick:
        it = items.get(iid)
        if not it: print(f'{iid}: нет в выгрузке, пропускаю'); continue
        page.evaluate('id => window.TOUR.isolate(id)', iid)
        room = next((r for r in model['rooms'] if r['id'] == it['room']), None)
        rc = room and [(room['rect'][0] + room['rect'][2]) / 2, (room['rect'][1] + room['rect'][3]) / 2]
        fov, c, cams = cameras(it['bounds'], rc)
        shots = []
        for title, eye in cams:
            page.evaluate('s => window.TOUR.view(s)', {'eye': eye, 'look': c, 'fov': fov, 'doors': 'asis', 'closeOthers': True, 'aspect': 1, 'lighting': 'work'})
            page.wait_for_timeout(120)
            p = out / f'_{iid}.png'; page.locator('#stage canvas').screenshot(path=str(p))
            shots.append((title, Image.open(p).convert('RGB'))); p.unlink()
        page.evaluate('() => window.TOUR.isolate(null)')
        bx = it['bounds']; W, D, H = bx[2] - bx[0], bx[3] - bx[1], bx[5] - bx[4]
        head = 120
        sheet = Image.new('RGB', (tile * 3, tile * 2 + head), '#faf9f5'); dr = ImageDraw.Draw(sheet)
        dr.text((18, 14), f"{iid} · {it['label']}", font=f_title, fill='#26352e')
        dr.text((18, 48), f"Габарит по геометрии модели (план, оси сцены): {W * 10:.0f} × {D * 10:.0f} × {H * 10:.0f} мм; низ {bx[4] * 10:.0f} мм, верх {bx[5] * 10:.0f} мм", font=f_text, fill='#4b6658')
        fid = it.get('fidelity') or models.get(iid)
        if fid and fid.get('expectCm'):
            e = fid['expectCm']; s = fid.get('sizeCm')
            ok = 'в допуске' if fid.get('ok') else 'ВНЕ ДОПУСКА'
            dr.text((18, 74), f"Паспорт: {e[0] * 10:.0f} × {e[1] * 10:.0f} × {e[2] * 10:.0f} мм" + (f"; модель: {s[0] * 10:.0f} × {s[1] * 10:.0f} × {s[2] * 10:.0f} мм" if s else '') + f"; отклонение {fid.get('deviation')} % — {ok}", font=f_text, fill='#26352e' if fid.get('ok') else '#9b2c2c')
        else:
            dr.text((18, 74), 'Паспорта нет: условный аналог. Для реального изделия задайте product (размеры производителя) в project.json.', font=f_small, fill='#66756b')
        for k, (title, im) in enumerate(shots):
            x, y = (k % 3) * tile, head + (k // 3) * tile
            sheet.paste(im, (x, y)); dr.rectangle([x, y, x + tile - 1, y + tile - 1], outline='#d8ddd6')
            dr.rectangle([x + 8, y + 8, x + 16 + dr.textlength(title, font=f_small), y + 30], fill='#faf9f5')
            dr.text((x + 12, y + 10), title, font=f_small, fill='#26352e')
        target = out / f'{iid}-six.jpg'; sheet.save(target, quality=88)
        index.append({'item': iid, 'file': target.name, 'sizeMm': [round(W * 10), round(D * 10), round(H * 10)], 'passport': bool(fid and fid.get('expectCm')), 'ok': (fid or {}).get('ok')})
        print(f'{iid}: {target.name}', flush=True)
    b.close()
(out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps({'out': str(out), 'sheets': len(index)}, ensure_ascii=False))
