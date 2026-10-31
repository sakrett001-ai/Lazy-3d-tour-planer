#!/usr/bin/env python3
"""План 1:50 (PDF A3 + SVG) и буклет проектных решений (PDF A4) из выгрузки и видов тура.

    python3 tools/documents.py <папка data> --images <папка видов> --out <папка> [--only plan|booklet]

Тексты, страницы и подписи — в project.json: sheet (лист плана) и booklet (страницы буклета).
Нужны reportlab, pypdf и шрифты DejaVu Sans (или пути в INTERIORS_FONT / INTERIORS_FONT_BOLD).
"""
import json, os, re, sys
from datetime import date
from pathlib import Path

from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject

sys.path.insert(0, str(Path(__file__).resolve().parent))
import drawing as D

args = sys.argv[1:]
data = Path(args[0]).resolve()
images = Path(args[args.index('--images') + 1]).resolve() if '--images' in args else data.parent / 'images'
out = Path(args[args.index('--out') + 1]).resolve() if '--out' in args else data.parent
only = args[args.index('--only') + 1] if '--only' in args else None
out.mkdir(parents=True, exist_ok=True)
M = json.loads((data / 'model.json').read_text(encoding='utf-8'))
meta = M.get('meta') or {}
V = {v['id']: v for v in M.get('views', [])}

FONT = os.environ.get('INTERIORS_FONT', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
FONTB = os.environ.get('INTERIORS_FONT_BOLD', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
pdfmetrics.registerFont(TTFont('D', FONT)); pdfmetrics.registerFont(TTFont('DB', FONTB))
color = colors.HexColor
BG, INK, GREEN, MUTED, LINE = D.BG, D.INK, D.GREEN, D.MUTED, D.LINE


def ru_date(s):
    try: y, m, d = (int(v) for v in s.split('-')); return f'{d:02d}.{m:02d}.{y}'
    except Exception: return s or date.today().strftime('%d.%m.%Y')


def slug(s): return re.sub(r'[^\w.-]+', '_', s).strip('_')


class Doc:
    def __init__(self, path, W, H, title, total):
        self.path, self.W, self.H, self.total, self.page = path, W, H, total, 0
        self.c = canvas.Canvas(str(path) + '.draft', pagesize=(W * mm, H * mm), pageCompression=1)
        self.c.setTitle(title); self.c.setAuthor(meta.get('author', 'Проект интерьера'))

    # --- примитивы
    def rect(self, x, y, w, h, fill=BG, stroke=None, r=0):
        o = D.Ops(); o.rect(x, y, w, h, fill, stroke, r); D.to_pdf(self.c, o.ops, self.H, mm, color)
    def line(self, x, y, x1, y1, col=LINE, wd=.25):
        o = D.Ops(); o.line(x, y, x1, y1, col, wd); D.to_pdf(self.c, o.ops, self.H, mm, color)
    def text(self, x, y, s, size=11, bold=False, col=INK, align='left'):
        o = D.Ops(); o.text(x, y, s, size, bold, col, align); D.to_pdf(self.c, o.ops, self.H, mm, color)
    def para(self, x, y, w, s, size=11, col=INK):
        p = Paragraph(s, ParagraphStyle('p', fontName='D', fontSize=size, leading=size * 1.4, textColor=color(col)))
        _, h = p.wrap(w * mm, 500 * mm); p.drawOn(self.c, x * mm, (self.H - y) * mm - h); return h / mm
    def note(self, x, y, w, title, body):
        self.text(x, y, title, 11.4, True, GREEN); return y + 3 + self.para(x, y + 3, w, body, 10.7) + 7
    def notes(self, x, y, w, items):
        for n in items or []: y = self.note(x, y, w, n['title'], n['body'])
        return y
    def photo(self, vid, x, y, w):
        f = images / f'{vid}.jpg'
        if f.exists(): self.c.drawImage(str(f), x * mm, (self.H - y - w / 1.6) * mm, w * mm, w / 1.6 * mm)
        else:
            self.rect(x, y, w, w / 1.6, '#e7e9e3'); self.text(x + w / 2, y + w / 3.2, f'нет снимка {vid}', 10, False, MUTED, 'center')
    def caption(self, vid, x, y, w, body, title=None):
        self.text(x, y, f"{vid} · {title or V.get(vid, {}).get('title', vid)}", 10.6, True); self.para(x, y + 3.5, w, body, 10.4, MUTED)
    def plan(self, box, x, y, w, h, **kw):
        o = D.Ops(); xy, u = D.plan(o, M, box, x, y, w, h, **kw); D.to_pdf(self.c, o.ops, self.H, mm, color); return xy, u, o
    def dims(self, xy, u, room=None, items=None):
        o = D.Ops(); D.dims(o, M, xy, u, room, items); D.to_pdf(self.c, o.ops, self.H, mm, color)

    # --- страница
    def start(self, title, subtitle='', section='ПРОЕКТНЫЕ РЕШЕНИЯ'):
        self.page += 1; W = self.W
        self.rect(0, 0, W, self.H); self.text(14, 12, section, 8.2, True, GREEN)
        self.text(W - 14, 12, f"{(meta.get('version') or '').upper()}  /  {ru_date(meta.get('date'))}", 8.2, False, MUTED, 'right')
        self.text(14, 25, title, 21, True)
        if subtitle: self.text(14, 33, subtitle, 10, False, MUTED)
        self.line(14, 38, W - 14, 38); self.c.bookmarkPage('p' + str(self.page)); self.c.addOutlineEntry(title, 'p' + str(self.page), level=0)
    def finish(self, footer):
        self.line(14, self.H - 15, self.W - 14, self.H - 15); self.text(14, self.H - 7, footer, 7.9, False, MUTED)
        self.text(self.W - 14, self.H - 7, f'{self.page:02d} / {self.total:02d}', 8.4, True, GREEN, 'right'); self.c.showPage()
    def save(self):
        self.c.save(); r = PdfReader(str(self.path) + '.draft'); wr = PdfWriter(); wr.clone_document_from_reader(r)
        wr.root_object[NameObject('/Lang')] = TextStringObject('ru-RU')
        with open(self.path, 'wb') as f: wr.write(f)
        Path(str(self.path) + '.draft').unlink()


def whole_box():
    B = M['bounds']; return [B[0] - 5, B[1] - 60, B[2] + 5, B[3]]


def room_box(rid, pad=50):
    r = next(q for q in M['rooms'] if q['id'] == rid); R = r.get('planRect') or r['rect']
    return [R[0] - pad, R[1] - pad - 40, R[2] + pad, R[3] + pad + 25]


# ---------------------------------------------------------------- лист плана A3
def plan_sheet():
    sh = M.get('sheet') or {}
    title = sh.get('title') or f"{meta.get('title', 'Интерьер')}: план расстановки"
    box = sh.get('box') or whole_box()
    W, H = 420, 297
    area_w, area_h = 271.4, 211
    scale = sh.get('scale') or next((s for s in (20, 25, 50, 75, 100, 150, 200, 250) if (box[2] - box[0]) * 10 / s <= area_w and (box[3] - box[1]) * 10 / s <= area_h), 250)
    u = 10 / scale
    name = sh.get('file') or f"{meta.get('title', 'Интерьер')}_план_{meta.get('version', '')}"
    path = out / (slug(name) + '.pdf')
    d = Doc(path, W, H, f"{title}. А3 1:{scale}", 1)
    d.start(title, sh.get('subtitle') or f'Размеры в мм по модели. А3, масштаб 1:{scale} при печати 100%.', sh.get('section') or 'ЛИСТ 01  /  ПЛАНИРОВКА')
    xy, u, ops = d.plan(box, 14, 43, area_w, area_h, ids=True, scale=u, labels=False)
    d.dims(xy, u)
    for r in M['rooms']:
        if r.get('hidden') or not r.get('planLabel'): continue
        d.text(*xy(*r['planLabel']), r.get('planName') or r['name'], 8.5, True, GREEN, 'center')
    y = d.notes(302, 49, 103, sh.get('notes'))
    d.text(14, 265, sh.get('footnote') or 'Размеры проектные. Перед заказом мебели и работами выполнить обмеры.', 10, False, MUTED)
    bar = 1000 / 10 * u  # 1000 мм
    d.line(302, 263, 302 + bar, 263, GREEN, .7); d.line(302, 261, 302, 265, GREEN, .4); d.line(302 + bar, 261, 302 + bar, 265, GREEN, .4)
    d.text(302 + bar / 2, 269, '1000 мм', 8.5, False, MUTED, 'center')
    d.finish(footer()); d.save()
    # SVG того же плана, 1:scale на листе
    o = D.Ops(); xy2, u2 = D.plan(o, M, box, 10, 10, (box[2] - box[0]) * u, (box[3] - box[1]) * u, ids=True, scale=u, labels=True); D.dims(o, M, xy2, u2)
    svg = out / (slug(name) + '.svg')
    svg.write_text(D.to_svg(o.ops, round((box[2] - box[0]) * u + 20, 1), round((box[3] - box[1]) * u + 20, 1), title), encoding='utf-8')
    return path, svg, scale


def footer():
    b = M.get('booklet') or {}
    return b.get('footer') or f"{meta.get('title', 'Интерьер').upper()}  /  ДЛЯ СОГЛАСОВАНИЯ"


# ---------------------------------------------------------------- буклет A4
def booklet():
    b = M.get('booklet') or {}
    pages = b.get('pages') or []
    if not pages: return None
    name = b.get('file') or f"{meta.get('title', 'Интерьер')}_буклет_{meta.get('version', '')}"
    path = out / (slug(name) + '.pdf')
    d = Doc(path, 297, 210, b.get('title') or f"{meta.get('title', 'Интерьер')}. Проектные решения", len(pages))
    for p in pages:
        kind = p['type']
        d.start(p['title'], p.get('subtitle', ''), p.get('section', 'ПРОЕКТНЫЕ РЕШЕНИЯ'))
        if kind == 'cover':
            d.photo(p['photo'], 14, 44, 210); d.notes(237, 55, 46, p.get('notes'))
            if p.get('footnote'): d.text(14, 189, p['footnote'], 10.2, False, MUTED)
        elif kind == 'plan':
            xy, u, _ = d.plan(p.get('box') or whole_box(), 14, 45, 190, 140, ids=p.get('ids', False), labels=True, cameras=p.get('cameras', []))
            d.dims(xy, u, items=p.get('dims') if 'dims' in p else (M.get('plan') or {}).get('dims', []))
            d.notes(215, 50, 68, p.get('notes'))
            if p.get('footnote'): d.text(14, 190, p['footnote'], 9.2, False, MUTED)
        elif kind == 'room':
            box = p.get('box') or room_box(p['room'])
            area = p.get('planArea')
            if not area:
                aw = min(160, 143 * (box[2] - box[0]) / (box[3] - box[1])); area = [14, 45, aw, 143]
            xy, u, _ = d.plan(box, *area, room=p['room'], cameras=p.get('cameras', []))
            d.dims(xy, u, p['room'], [dm for dm in (M.get('plan') or {}).get('dims', []) if dm.get('rooms') and p['room'] in dm['rooms']] + p.get('dims', []))
            nx = area[0] + area[2] + 12
            d.notes(nx, 49, 283 - nx, p.get('notes'))
            if p.get('footnote'): d.text(area[0] + 4, 193, p['footnote'], 9.1, False, GREEN)
        elif kind == 'views':
            ph = p['photos']
            for k, f in enumerate(ph[:2]):
                x = 14 + k * 138
                d.photo(f['view'], x, 45, 131); d.caption(f['view'], x, 133, 131, f['caption'], f.get('title'))
            if p.get('band'): d.rect(14, 165, 269, 22, '#ecefe6', r=2); d.para(20, 170, 257, p['band'], 10.8)
        elif kind == 'roomPhoto':
            box = p.get('box') or room_box(p['room'])
            xy, u, _ = d.plan(box, 14, 44, 89, 146, room=p['room'], cameras=p.get('cameras', []))
            d.dims(xy, u, p['room'], [dm for dm in (M.get('plan') or {}).get('dims', []) if dm.get('rooms') and p['room'] in dm['rooms']] + p.get('dims', []))
            f = p['photo']; d.photo(f['view'], 115, 45, 168); d.caption(f['view'], 115, 155, 168, f['caption'], f.get('title'))
            if p.get('text'): d.para(115, 176, 168, p['text'], 10.3, MUTED)
        elif kind == 'materials':
            f = p['photo']; d.photo(f['view'], 14, 45, 147); d.caption(f['view'], 14, 143, 147, f['caption'], f.get('title'))
            y = 45
            for s in p.get('swatches', []):
                d.rect(176, y, 13, 12, s['color'], LINE, 1); d.text(194, y + 4.5, s['title'], 10.4, True); d.text(194, y + 9.5, s.get('body', ''), 8.3, False, MUTED); y += 16
            if p.get('text'): d.para(176, max(y + 6, 130), 107, p['text'], 10.5)
            if p.get('footnote'): d.para(14, 174, 269, p['footnote'], 9.5, MUTED)
        else:
            raise SystemExit(f'Неизвестный тип страницы: {kind}')
        d.finish(footer())
    d.save(); return path


res = {}
if only in (None, 'plan'):
    pdf, svg, scale = plan_sheet(); res['plan'] = str(pdf); res['svg'] = str(svg); res['scale'] = f'1:{scale}'
if only in (None, 'booklet'):
    bk = booklet(); res['booklet'] = str(bk) if bk else None
print(json.dumps(res, ensure_ascii=False))
