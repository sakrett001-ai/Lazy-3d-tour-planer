"""Фотореалистичный рендер видов интерьера в Blender/Cycles по выгрузке scene-export.cjs.

    <python с bpy> tools/cycles_render.py <папка сцены> --views C1,C2 --out <папка> [--size 1600x1000] [--samples 64]
                   [--sun 3.5] [--sky 3] [--lamp 18] [--emit 6] [--exposure 1.1]

Сцена — те же треугольники, материалы и карты, что в туре; свет пересчитан физически (солнце, небо, светильники,
светящиеся поверхности). Контактные тени и отражения — настоящие, декали теней тура не выгружаются.
Модуль bpy: python 3.11 + `pip install bpy==4.5.3` (проверено) или `blender -b --python cycles_render.py -- …`.
Освещение подбирается коэффициентами; это иллюстрация, а не светотехнический расчёт.
"""
import argparse, json, math, sys, time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument('scene'); ap.add_argument('--views', default=''); ap.add_argument('--out', required=True)
ap.add_argument('--size', default='1600x1000'); ap.add_argument('--samples', type=int, default=64)
ap.add_argument('--sun', type=float, default=3.5); ap.add_argument('--sky', type=float, default=3.0)
ap.add_argument('--lamp', type=float, default=18.0); ap.add_argument('--emit', type=float, default=6.0)
ap.add_argument('--exposure', type=float, default=1.1); ap.add_argument('--blend')
a = ap.parse_args(argv)
src = Path(a.scene).resolve(); out = Path(a.out).resolve(); out.mkdir(parents=True, exist_ok=True)
spec = json.loads((src / 'scene.json').read_text(encoding='utf-8'))
assert spec.get('schema') == 'interiors-cycles/1' and spec.get('axes') == 'Z-up', 'неизвестный формат сцены'
W, H = (int(v) for v in a.size.split('x'))
t0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
data = np.fromfile(src / 'scene.bin', dtype=np.float32).reshape(-1, 8)

# --- изображения
images = {}
def image(idx):
    if idx is None: return None
    if idx not in images:
        t = spec['textures'][idx]; img = bpy.data.images.load(str(src / t['file']))
        img.colorspace_settings.name = 'sRGB' if t['srgb'] else 'Non-Color'; images[idx] = img
    return images[idx]

# --- материалы
def material(i, m):
    mat = bpy.data.materials.new(f"m{i}_{m['name']}"[:60]); mat.use_nodes = True
    nt = mat.node_tree; nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']; outn = nodes['Material Output']
    col = tuple(m['color'][:3]) + (1,)
    def tex(idx, non_color=False):
        n = nodes.new('ShaderNodeTexImage'); n.image = image(idx); n.extension = 'REPEAT'; n.interpolation = 'Linear'; return n
    if m['basic']:
        em = nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0
        if m['map'] is not None:
            tn = tex(m['map']); mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
            links.new(tn.outputs['Color'], mul.inputs['A']); mul.inputs['B'].default_value = col; links.new(mul.outputs['Result'], em.inputs['Color'])
        else: em.inputs['Color'].default_value = col
        links.new(em.outputs['Emission'], outn.inputs['Surface']); return mat
    base = None
    if m['map'] is not None:
        tn = tex(m['map']); mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
        links.new(tn.outputs['Color'], mul.inputs['A']); mul.inputs['B'].default_value = col; links.new(mul.outputs['Result'], bsdf.inputs['Base Color']); base = tn
        if m['alphaTest'] > 0: links.new(tn.outputs['Alpha'], bsdf.inputs['Alpha'])
    else: bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Metallic'].default_value = m['metalness']
    if m['roughnessMap'] is not None:
        rn = tex(m['roughnessMap']); sep = nodes.new('ShaderNodeSeparateColor'); mth = nodes.new('ShaderNodeMath'); mth.operation = 'MULTIPLY'; mth.inputs[1].default_value = m['roughness']
        links.new(rn.outputs['Color'], sep.inputs['Color']); links.new(sep.outputs['Green'], mth.inputs[0]); links.new(mth.outputs['Value'], bsdf.inputs['Roughness'])
    else: bsdf.inputs['Roughness'].default_value = max(.02, m['roughness'])
    if m['normalMap'] is not None:
        nn = tex(m['normalMap']); nm = nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = min(1.5, abs(m['normalScale']) * 1.6)
        links.new(nn.outputs['Color'], nm.inputs['Color']); links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    e = m['emissiveIntensity'] * max(m['emissive'])
    if e > 0:
        k = a.emit if m['emissiveMap'] is None else 1.5
        if m['emissiveMap'] is not None:
            en = tex(m['emissiveMap']); links.new(en.outputs['Color'], bsdf.inputs['Emission Color'])
        else: bsdf.inputs['Emission Color'].default_value = tuple(m['emissive'][:3]) + (1,)
        bsdf.inputs['Emission Strength'].default_value = m['emissiveIntensity'] * k
    if m['opacity'] < 1: bsdf.inputs['Alpha'].default_value = m['opacity']
    if m.get('sheen'): bsdf.inputs['Sheen Weight'].default_value = min(1, m['sheen'])
    return mat
mats = [material(i, m) for i, m in enumerate(spec['materials'])]

# --- геометрия: один объект на материал
by_mat = {}
for p in spec['parts']: by_mat.setdefault(p['material'], []).append(p)
coll = scene.collection
for mi, parts in by_mat.items():
    rows = np.concatenate([data[p['offset']:p['offset'] + p['count']] for p in parts])
    n = len(rows) - len(rows) % 3
    if n == 0: continue
    rows = rows[:n]
    me = bpy.data.meshes.new(f'mesh{mi}')
    me.vertices.add(n); me.vertices.foreach_set('co', rows[:, 0:3].ravel())
    me.loops.add(n); me.loops.foreach_set('vertex_index', np.arange(n, dtype=np.int32))
    me.polygons.add(n // 3); me.polygons.foreach_set('loop_start', np.arange(0, n, 3, dtype=np.int32)); me.polygons.foreach_set('loop_total', np.full(n // 3, 3, dtype=np.int32))
    uv = me.uv_layers.new(name='UV'); uv.data.foreach_set('uv', rows[:, 6:8].ravel())
    me.update(calc_edges=True); me.validate(clean_customdata=False)
    me.polygons.foreach_set('use_smooth', np.ones(n // 3, dtype=bool))
    me.normals_split_custom_set(rows[:, 3:6].tolist())
    me.materials.append(mats[mi])
    ob = bpy.data.objects.new(f'obj{mi}', me); coll.objects.link(ob)

# --- свет: солнце, небо, светильники
sun_d = bpy.data.lights.new('sun', 'SUN'); sun_d.energy = a.sun * spec['sun']['intensity'] / 2.2; sun_d.color = spec['sun']['color'][:3]; sun_d.angle = math.radians(1.2)
sun = bpy.data.objects.new('sun', sun_d); coll.objects.link(sun)
sun.rotation_euler = Vector(spec['sun']['direction']).to_track_quat('-Z', 'Y').to_euler()
world = bpy.data.worlds.new('sky'); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links; bg = wn['Background']
grad = wn.new('ShaderNodeTexGradient'); grad.gradient_type = 'LINEAR'; tc = wn.new('ShaderNodeTexCoord'); mp = wn.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, -math.pi / 2, 0)
ramp = wn.new('ShaderNodeValToRGB')
dusk = spec['sky']['dusk']
ramp.color_ramp.elements[0].color = (0.70 - .5 * dusk, 0.74 - .55 * dusk, 0.78 - .55 * dusk, 1); ramp.color_ramp.elements[1].color = (0.22 - .2 * dusk, 0.36 - .33 * dusk, 0.62 - .5 * dusk, 1)
wl.new(tc.outputs['Generated'] if False else tc.outputs['Object'], mp.inputs['Vector']); wl.new(mp.outputs['Vector'], grad.inputs['Vector'])
wl.new(grad.outputs['Fac'], ramp.inputs['Fac']); wl.new(ramp.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = a.sky * (1 - .7 * dusk)
for i, l in enumerate(spec['lamps']):
    if l['intensity'] <= 0: continue
    d = bpy.data.lights.new(f'lamp{i}', 'SPOT'); d.energy = l['intensity'] * a.lamp * (0.6 if l['kind'] == 'task' else 1)
    d.color = l['color'][:3]; d.spot_size = min(math.pi, 2 * l['angle'] + .6); d.spot_blend = .8; d.shadow_soft_size = .12
    o = bpy.data.objects.new(f'lamp{i}', d); coll.objects.link(o); o.location = l['position']
    o.rotation_euler = (Vector(l['target']) - Vector(l['position'])).to_track_quat('-Z', 'Y').to_euler()

# --- рендер
scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = a.samples
scene.cycles.use_adaptive_sampling = True; scene.cycles.adaptive_threshold = .03
scene.cycles.use_denoising = True
try: scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception: pass
scene.cycles.max_bounces = 6; scene.cycles.diffuse_bounces = 3; scene.cycles.glossy_bounces = 3; scene.cycles.transparent_max_bounces = 12
scene.cycles.sample_clamp_indirect = 8
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
scene.view_settings.view_transform = 'AgX'
try: scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass
scene.view_settings.exposure = a.exposure
scene.render.image_settings.file_format = 'PNG'
cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); coll.objects.link(cam); scene.camera = cam
cam_d.sensor_fit = 'VERTICAL'; cam_d.sensor_height = 24; cam_d.clip_start = .03; cam_d.clip_end = 400
want = [v for v in a.views.split(',') if v] or [c['id'] for c in spec['cameras']]
known = [c['id'] for c in spec['cameras']]
if not want or set(want) - set(known): raise ValueError('Unknown or empty camera selection')
if a.blend and len(want) != 1: raise ValueError('--blend requires exactly one selected view')
setup = time.time() - t0; done = []
for c in spec['cameras']:
    if c['id'] not in want: continue
    t1 = time.time()
    cam.location = c['eye']; cam.rotation_euler = (Vector(c['look']) - Vector(c['eye'])).to_track_quat('-Z', 'Y').to_euler()
    cam_d.lens = 24 / (2 * math.tan(math.radians(c['fov']) / 2))
    png = out / f"{c['id']}.png"; scene.render.filepath = str(png)
    if a.blend:
        blend = Path(a.blend).resolve(); blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    try:
        from PIL import Image
        Image.open(png).convert('RGB').save(out / f"{c['id']}.jpg", quality=90, optimize=True); png.unlink()
    except ImportError: pass
    done.append({'view': c['id'], 'seconds': round(time.time() - t1, 1)})
    print(json.dumps(done[-1], ensure_ascii=False), flush=True)
print(json.dumps({'renderer': 'Cycles CPU', 'setupSeconds': round(setup, 1), 'views': done, 'size': f'{W}x{H}', 'samples': a.samples}, ensure_ascii=False))
