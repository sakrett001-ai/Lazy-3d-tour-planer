#!/usr/bin/env python3
"""Exercise the real exporter with a fake render process. This does not test Cycles."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent
FAKE = '''#!/usr/bin/env python3
import os,sys
from pathlib import Path
from PIL import Image
a=sys.argv
assert '--python-exit-code' in a and a[a.index('--python-exit-code')+1]=='1'
ids=a[a.index('--views')+1].split(',');out=Path(a[a.index('--out')+1]);out.mkdir(parents=True,exist_ok=True)
mode=os.environ.get('FAKE_MODE','ok')
if mode=='empty':sys.exit(0)
if mode=='exit':print('{"view":"K1"}');sys.exit(9)
size=tuple(map(int,a[a.index('--size')+1].split('x')))
for v in ids[:1] if mode=='partial' else ids:
 p=out/(v+'.png')
 if mode=='broken':p.write_text('bad image')
 else:Image.new('RGB',size,(80,100,120)).save(p)
'''


class PhotoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(); cls.tour = Path(cls.shared.name) / 'tour.html'
        subprocess.run(['node', str(ENGINE / 'build.mjs'), str(ENGINE / 'projects/template-kabinet'), '--out', str(cls.tour)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls): cls.shared.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.out = self.root / 'out'
        self.fake = self.root / 'blender'; self.fake.write_text(FAKE); self.fake.chmod(0o755)

    def run_photo(self, mode='ok', views='K1,K2'):
        env=os.environ.copy(); env.pop('INTERIORS_BPY_PYTHON', None)
        env['INTERIORS_BLENDER']=str(self.fake); env['FAKE_MODE']=mode
        return subprocess.run([sys.executable,str(HERE/'photoreal.py'),str(self.tour),'--out',str(self.out),
                               '--views',views,'--size','20x12','--samples','1'],env=env,capture_output=True,text=True)

    def test_two_views_verified(self):
        result=self.run_photo(); self.assertEqual(result.returncode,0,result.stderr)
        report=json.loads((self.out/'cycles-report.json').read_text())
        self.assertEqual(report['status'],'complete');self.assertEqual(len(report['views']),2)

    def test_stale_files_do_not_mask_empty_render(self):
        self.out.mkdir();Image.new('RGB',(20,12)).save(self.out/'K1.png');Image.new('RGB',(20,12)).save(self.out/'K2.png')
        self.assertNotEqual(self.run_photo('empty').returncode,0)
        self.assertEqual(json.loads((self.out/'cycles-report.json').read_text())['status'],'failed')

    def test_incomplete_group_fails(self): self.assertNotEqual(self.run_photo('partial').returncode,0)
    def test_corrupt_image_fails(self): self.assertNotEqual(self.run_photo('broken').returncode,0)
    def test_process_error_fails(self): self.assertNotEqual(self.run_photo('exit').returncode,0)
    def test_unknown_view_fails(self): self.assertNotEqual(self.run_photo(views='missing').returncode,0)

    def test_publication_collision_preserves_previous_image(self):
        self.out.mkdir();Image.new('RGB',(20,12),'blue').save(self.out/'K1.png')
        original=(self.out/'K1.png').read_bytes();(self.out/'K2.png').mkdir()
        self.assertNotEqual(self.run_photo().returncode,0)
        self.assertEqual(json.loads((self.out/'cycles-report.json').read_text())['status'],'failed')
        self.assertEqual((self.out/'K1.png').read_bytes(),original)

    def test_alternate_extension_collision_preserves_previous_image(self):
        self.out.mkdir();Image.new('RGB',(20,12),'blue').save(self.out/'K1.png')
        original=(self.out/'K1.png').read_bytes();(self.out/'K2.jpg').mkdir()
        self.assertNotEqual(self.run_photo().returncode,0)
        self.assertEqual(json.loads((self.out/'cycles-report.json').read_text())['status'],'failed')
        self.assertEqual((self.out/'K1.png').read_bytes(),original)


if __name__ == '__main__': unittest.main()
