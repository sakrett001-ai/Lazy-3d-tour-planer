"""Векторный план из выгрузки model.json: один набор операций рисования → PDF (reportlab) или SVG.

Координаты листа — миллиметры, ось y вниз. Масштаб u — мм листа на 1 см модели (1:50 → 0.2).
"""
import math
from xml.sax.saxutils import escape

BG = '#faf9f5'; INK = '#26352e'; GREEN = '#4b6658'; MUTED = '#66756b'; LINE = '#d8ddd6'
FILL = {'furniture': '#dfd5c2', 'seat': '#aebfb2', 'dark': '#38493e', 'equipment': '#edf1ed', 'wet': '#d9e5e1', 'white': '#ffffff'}
STROKE = '#6d786d'; WALL = '#46554a'; GLASS = '#829e9b'; SEAM = '#718d7c'; CROSS = '#93aaa2'


class Ops:
    """Список операций рисования в мм листа."""
    def __init__(self): self.ops = []
    def rect(self, x, y, w, h, fill=BG, stroke=None, r=0, sw=.25): self.ops.append(('rect', x, y, w, h, fill, stroke, r, sw))
    def line(self, x, y, x1, y1, col=LINE, wd=.25, dash=None): self.ops.append(('line', x, y, x1, y1, col, wd, dash))
    def ellipse(self, cx, cy, rx, ry, fill, stroke=STROKE, sw=.2): self.ops.append(('ellipse', cx, cy, rx, ry, fill, stroke, sw))
    def circle(self, cx, cy, r, fill): self.ops.append(('ellipse', cx, cy, r, r, fill, None, 0))
    def text(self, x, y, s, size=11, bold=False, col=INK, align='left', rotate=0): self.ops.append(('text', x, y, s, size, bold, col, align, rotate))
    def clip(self, x, y, w, h): self.ops.append(('clip', x, y, w, h))
    def unclip(self): self.ops.append(('unclip',))


def plan(o, model, box, x, y, w, h, room=None, ids=True, cameras=(), labels=False, scale=None, views=None):
    """Нарисовать план модели в окне листа. box — [x0, y0, x1, y1] модели в см. Возвращает (xy, u)."""
    a, b, d, e = box
    u = scale or min(w / (d - a), h / (e - b))
    ox = x + (w - (d - a) * u) / 2; oy = y + (h - (e - b) * u) / 2
    xy = lambda xx, yy: (ox + (xx - a) * u, oy + (yy - b) * u)
    def rp(r, fill, stroke=STROKE): q0, q1, q2, q3 = r[:4]; o.rect(*xy(q0, q1), (q2 - q0) * u, (q3 - q1) * u, fill, stroke, .35)
    def lp(p, q, col=LINE, wd=.2, dash=None): o.line(*xy(*p), *xy(*q), col, wd, dash)
    def ell(cx, cy, rx, ry, fill): px, py = xy(cx, cy); o.ellipse(px, py, rx * u, ry * u, fill)
    pl = model.get('plan') or {}
    hide = set(pl.get('hideIds', [])); id_at = pl.get('idAt', {})
    o.clip(ox, oy, (d - a) * u, (e - b) * u)
    for r in model['rooms']:
        if r.get('hidden') or not r.get('planColor'): continue
        rp(r.get('planRect') or r['rect'], r['planColor'], r['planColor'])
    # стены: сплошные участки толщиной стены, окна тремя линиями, двери — разрывом
    for wall in model['walls']:
        p, q = wall['a'], wall['b']; L = math.dist(p, q); dx = (q[0] - p[0]) / L; dy = (q[1] - p[1]) / L
        cuts = sorted(set([0, L] + [v for op in wall['ops'] for v in (op['s'], op['e'])]))
        for j, k in zip(cuts, cuts[1:]):
            op = next((op for op in wall['ops'] if op['s'] < (j + k) / 2 < op['e']), None)
            p0 = (p[0] + j * dx, p[1] + j * dy); q0 = (p[0] + k * dx, p[1] + k * dy)
            if not op: lp(p0, q0, WALL, wall['t'] * u)
            elif op['type'] == 'window':
                for off in (-wall['t'] / 2 + 2, 0, wall['t'] / 2 - 2): lp((p0[0] - dy * off, p0[1] + dx * off), (q0[0] - dy * off, q0[1] + dx * off), GLASS, .3)
    for ln in pl.get('lines', []):
        if room and ln.get('rooms') and room not in ln['rooms']: continue
        lp(ln['from'], ln['to'], GREEN, .30, [1.4, 1.0] if ln.get('style', 'sight') == 'sight' else None)
    def symbols(syms, cat_default):
        for s in syms:
            cat = s.get('category') or cat_default
            if s['kind'] == 'circle': ell(s['c'][0], s['c'][1], s['r'], s['r'], FILL.get(cat, FILL['furniture']))
            elif s['kind'] == 'ellipse': ell(s['c'][0], s['c'][1], s['r'][0], s['r'][1], FILL.get(cat, FILL['white']))
            elif s['kind'] == 'rect' and len(s.get('rect') or []) == 4:
                rp(s['rect'], FILL.get(cat, FILL['furniture']))
                if s.get('cross'): r = s['rect']; lp((r[0], r[1]), (r[2], r[3]), CROSS); lp((r[2], r[1]), (r[0], r[3]), CROSS)
                if s.get('text') and room: cx, cy = (s['rect'][0] + s['rect'][2]) / 2, (s['rect'][1] + s['rect'][3]) / 2; o.text(*xy(cx, cy + 5), s['text'], 7.8, True, INK, 'center')
            elif s['kind'] == 'lines':
                for p, q in s['lines']: lp(p, q, s.get('color', SEAM), .25)
    for i in model['items']:
        if room and i['room'] != room: continue
        r = i['rect'] or i['bounds']
        if not r: continue
        syms = i.get('plan') or []
        shaped = [s for s in syms if s['kind'] in ('circle', 'ellipse')]
        if shaped: symbols(shaped, i['category'])
        elif i['category'] == 'dark': rp(r, FILL['dark'])
        else: rp(r, FILL.get(i['category'], FILL['furniture']))
        symbols([s for s in syms if s['kind'] not in ('circle', 'ellipse')], i['category'])
        if ids and i['id'] not in hide:
            cx, cy = id_at.get(i['id'], ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2))
            o.text(*xy(cx, cy + 5), i['id'], 8.2, True, INK, 'center')
    for s in model.get('decor', []):
        if room and s.get('rooms') and room not in s['rooms']: continue
        if room and not s.get('rooms'):
            ref = s.get('c') or (s.get('rect') or [None] * 4)[:2]
            rr = next((q for q in model['rooms'] if q['id'] == room), None)
            if rr and ref and ref[0] is not None:
                R = rr.get('planRect') or rr['rect']
                if not (R[0] - 40 <= ref[0] <= R[2] + 40 and R[1] - 40 <= ref[1] <= R[3] + 40): continue
        symbols([s], s.get('category', 'furniture'))
    # двери: полотно в открытом положении и пунктирная дуга хода
    for door in model['doors']:
        p, q, t = door['pivot'], door['closed'], door['opened']
        lp(p, t, GREEN, .5)
        rad = math.dist(p, q); st = math.atan2(q[1] - p[1], q[0] - p[0])
        en = math.atan2(t[1] - p[1], t[0] - p[0]); ang = (en - st + math.pi) % (2 * math.pi) - math.pi
        pts = [(p[0] + rad * math.cos(st + ang * k / 40), p[1] + rad * math.sin(st + ang * k / 40)) for k in range(41)]
        for j in range(0, 40, 2): lp(pts[j], pts[j + 1], GREEN, .23)
    if labels:
        for r in model['rooms']:
            if r.get('hidden') or not r.get('planLabel'): continue
            o.text(*xy(*r['planLabel']), (r.get('planName') or r['name']).upper(), 8.1, True, GREEN, 'center')
    V = {v['id']: v for v in (views or model.get('views') or [])}
    for key in cameras:
        v = V[key]; cx, cy = xy(*v['eye'][:2]); tx, ty = xy(*v['look'][:2]); dx, dy = tx - cx, ty - cy; L = math.hypot(dx, dy); dx /= L; dy /= L
        o.line(cx, cy, cx + dx * 7, cy + dy * 7, GREEN, .5)
        o.line(cx + dx * 7, cy + dy * 7, cx + dx * 4.7 - dy * 1.6, cy + dy * 4.7 + dx * 1.6, GREEN, .4)
        o.line(cx + dx * 7, cy + dy * 7, cx + dx * 4.7 + dy * 1.6, cy + dy * 4.7 - dx * 1.6, GREEN, .4)
        o.circle(cx, cy, 3.2, GREEN); o.text(cx, cy + 1, key, 7.8, True, '#ffffff', 'center')
    o.unclip()
    return xy, u


def dimh(o, x0, x1, y, s):
    o.line(x0, y, x1, y, MUTED, .22)
    for x in (x0, x1): o.line(x, y - 1.2, x, y + 1.2, MUTED, .22)
    o.text((x0 + x1) / 2, y - 1.2, s, 8.4, False, MUTED, 'center')


def dimv(o, x, y0, y1, s):
    o.line(x, y0, x, y1, MUTED, .22)
    for y in (y0, y1): o.line(x - 1.2, y, x + 1.2, y, MUTED, .22)
    o.text(x - 1.5, (y0 + y1) / 2, s, 8.4, False, MUTED, 'center', rotate=90)


def dims(o, model, xy, u, only_room=None, items=None):
    """Размерные цепи из project.plan.dims: axis x — над планом, y — слева. Текст по умолчанию — мм."""
    B = model['bounds']
    for dm in items if items is not None else (model.get('plan') or {}).get('dims', []):
        if only_room and dm.get('rooms') and only_room not in dm['rooms']: continue
        if only_room and not dm.get('rooms'):
            rr = next((q for q in model['rooms'] if q['id'] == only_room), None)
            R = (rr.get('planRect') or rr['rect']) if rr else None
            if R and dm['axis'] == 'x' and (dm['to'] < R[0] - 1 or dm['from'] > R[2] + 1): continue
            if R and dm['axis'] == 'y' and (dm['to'] < R[1] - 1 or dm['from'] > R[3] + 1): continue
        txt = dm.get('text') or str(round((dm['to'] - dm['from']) * 10))
        if dm['axis'] == 'x':
            if 'at' in dm: yy = xy(0, dm['at'])[1]
            else: yy = xy(0, B[1])[1] - 3
            dimh(o, xy(dm['from'], 0)[0], xy(dm['to'], 0)[0], yy, txt)
        else:
            x0 = (xy(dm['at'], 0)[0] if 'at' in dm else xy(B[0], 0)[0] - 3)
            if only_room and 'at' not in dm:
                rr = next((q for q in model['rooms'] if q['id'] == only_room), None)
                if rr: x0 = xy((rr.get('planRect') or rr['rect'])[0], 0)[0] - 3 - 3
            dimv(o, x0, xy(0, dm['from'])[1], xy(0, dm['to'])[1], txt)


# ---------------------------------------------------------------- вывод
def to_pdf(c, ops, H, mm, color, font='D', bold='DB'):
    clipped = False
    for op in ops:
        k = op[0]
        if k == 'rect':
            _, x, y, w, h, fill, stroke, r, sw = op
            c.setFillColor(color(fill)); c.setStrokeColor(color(stroke or fill)); c.setLineWidth(sw * mm)
            if r: c.roundRect(x * mm, (H - y - h) * mm, w * mm, h * mm, r * mm, fill=1, stroke=bool(stroke))
            else: c.rect(x * mm, (H - y - h) * mm, w * mm, h * mm, fill=1, stroke=bool(stroke))
        elif k == 'line':
            _, x, y, x1, y1, col, wd, dash = op
            c.setStrokeColor(color(col)); c.setLineWidth(wd * mm); c.setDash([v * mm for v in dash] if dash else []); c.line(x * mm, (H - y) * mm, x1 * mm, (H - y1) * mm); c.setDash([])
        elif k == 'ellipse':
            _, cx, cy, rx, ry, fill, stroke, sw = op
            c.setFillColor(color(fill)); c.setStrokeColor(color(stroke or fill)); c.setLineWidth(sw * mm)
            c.ellipse((cx - rx) * mm, (H - cy - ry) * mm, (cx + rx) * mm, (H - cy + ry) * mm, fill=1, stroke=bool(stroke))
        elif k == 'text':
            _, x, y, s, size, b, col, align, rot = op
            c.saveState(); c.setFont(bold if b else font, size); c.setFillColor(color(col)); c.translate(x * mm, (H - y) * mm)
            if rot: c.rotate(rot)
            getattr(c, {'left': 'drawString', 'center': 'drawCentredString', 'right': 'drawRightString'}[align])(0, 0, s); c.restoreState()
        elif k == 'clip':
            _, x, y, w, h = op
            c.saveState(); p = c.beginPath(); p.rect(x * mm, (H - y - h) * mm, w * mm, h * mm); c.clipPath(p, fill=0, stroke=0); clipped = True
        elif k == 'unclip' and clipped:
            c.restoreState(); clipped = False


def to_svg(ops, W, H, title=''):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}" font-family="DejaVu Sans, Arial, sans-serif">',
           f'<title>{escape(title)}</title>', f'<rect width="{W}" height="{H}" fill="{BG}"/>']
    clip_id = 0; open_g = False
    f = lambda v: f'{v:.3f}'.rstrip('0').rstrip('.')
    for op in ops:
        k = op[0]
        if k == 'rect':
            _, x, y, w, h, fill, stroke, r, sw = op
            out.append(f'<rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}"' + (f' rx="{f(r)}"' if r else '') + f' fill="{fill}"' + (f' stroke="{stroke}" stroke-width="{f(sw)}"' if stroke else '') + '/>')
        elif k == 'line':
            _, x, y, x1, y1, col, wd, dash = op
            out.append(f'<line x1="{f(x)}" y1="{f(y)}" x2="{f(x1)}" y2="{f(y1)}" stroke="{col}" stroke-width="{f(wd)}"' + (f' stroke-dasharray="{" ".join(f(v) for v in dash)}"' if dash else '') + '/>')
        elif k == 'ellipse':
            _, cx, cy, rx, ry, fill, stroke, sw = op
            out.append(f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}" fill="{fill}"' + (f' stroke="{stroke}" stroke-width="{f(sw)}"' if stroke else '') + '/>')
        elif k == 'text':
            _, x, y, s, size, b, col, align, rot = op
            anchor = {'left': 'start', 'center': 'middle', 'right': 'end'}[align]
            tr = f' transform="rotate({-rot} {f(x)} {f(y)})"' if rot else ''
            out.append(f'<text x="{f(x)}" y="{f(y)}" font-size="{f(size * 0.3528)}" fill="{col}" text-anchor="{anchor}"' + (' font-weight="bold"' if b else '') + f'{tr}>{escape(s)}</text>')
        elif k == 'clip':
            _, x, y, w, h = op; clip_id += 1
            out.append(f'<clipPath id="c{clip_id}"><rect x="{f(x)}" y="{f(y)}" width="{f(w)}" height="{f(h)}"/></clipPath><g clip-path="url(#c{clip_id})">'); open_g = True
        elif k == 'unclip' and open_g:
            out.append('</g>'); open_g = False
    out.append('</svg>')
    return '\n'.join(out)
