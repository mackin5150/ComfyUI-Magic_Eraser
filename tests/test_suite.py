import unittest
import numpy as np
import torch
from PIL import Image
from harness import package as p
from pristine_test.core import heal, detect, safe_path, persist, encode, decode

class SuiteTests(unittest.TestCase):
    def test_roundtrip_and_reference_security(self):
        im=Image.new('RGBA',(32,24),(1,2,3,120))
        self.assertEqual(decode(encode(im)).getpixel((0,0)),(1,2,3,120))
        for bad in ('../secrets.png','/etc/passwd','a.png','0'*32+'.png/../x'):
            with self.assertRaises(ValueError):safe_path(p.root(),bad)
    def test_repair_preserves_unmasked_and_alpha(self):
        a=np.full((64,64,4),[180,130,70,140],dtype=np.uint8);a[25:35,25:35,:3]=0
        m=np.zeros((64,64),np.uint8);m[24:36,24:36]=255
        repaired=np.array(heal(Image.fromarray(a),Image.fromarray(m)))
        np.testing.assert_array_equal(repaired[m==0],a[m==0]);np.testing.assert_array_equal(repaired[...,3],a[...,3])
        self.assertGreater(repaired[30,30,0],100)
    def test_color_selection(self):
        a=np.zeros((20,20,3),np.uint8);a[:,10:]=255
        m=np.array(detect(Image.fromarray(a),2,2,10))
        self.assertTrue(np.all(m[:,:10]==255));self.assertFalse(np.any(m[:,10:]))
    def test_apply_and_tensor_exports(self):
        im=Image.new('RGBA',(40,32),(20,40,60,128));m=Image.new('L',im.size,255)
        names=[persist(p.root(),x) for x in (im,m,im)]
        image,mask,original,rgba=p.PristineEditor().execute(*names)
        self.assertEqual(tuple(image.shape),(1,32,40,3));self.assertEqual(tuple(rgba.shape),(1,32,40,4));self.assertTrue(torch.all(mask==1))
        rgb,alpha=p.PristineRGBA().execute(rgba);self.assertTrue(torch.allclose(alpha,torch.full_like(alpha,127/255)))
    def test_main_node_model_render_and_save_separation(self):
        from unittest.mock import patch
        node=p.PristineEditor()
        schema=node.INPUT_TYPES()
        for key in ('model','vae','positive','negative'):
            self.assertTrue(schema['optional'][key][1]['lazy'])
        self.assertEqual(node.check_lazy_status(),[])
        self.assertEqual(node.check_lazy_status(model_request='job'),['model','vae','positive','negative'])
        self.assertEqual(node.check_lazy_status(model_request='job',model=object(),vae=object(),positive=[],negative=[]),[])
        im=Image.new('RGBA',(40,32),(20,40,60,128));m=Image.new('L',im.size)
        import PIL.ImageDraw
        PIL.ImageDraw.Draw(m).rectangle((10,10,20,20),fill=255)
        names=[persist(p.root(),x) for x in (im,m,im)]
        def fake(image,mask,*args):
            return (image*(1-mask[...,None])+torch.ones_like(image)*mask[...,None],)
        with patch.object(p.PristineModelInpaint,'execute',side_effect=fake) as model:
            node.execute(*names)
            model.assert_not_called()
            with self.assertRaisesRegex(ValueError,'Connect MODEL'):
                node.execute(*names,model_request='job')
            result=p.PristineEditorRender().execute(*names,model=object(),vae=object(),positive=[],negative=[],model_request='job')
            model.assert_called_once()
            image,mask,original,rgba=result['result']
            self.assertEqual(image.shape,(1,32,40,3));self.assertTrue(torch.all(mask==0))
            self.assertTrue(torch.all(image[:,10:21,10:21]==1))
            self.assertTrue(torch.all(rgba[:,10:21,10:21,3]==1))
            self.assertAlmostEqual(rgba[0,0,0,3].item(),128/255,places=6)
            entry=result['ui']['pristine_result'][0]
            self.assertEqual(entry['request_id'],'job')
            self.assertEqual(entry['original_asset'],names[2])
            self.assertNotEqual(entry['edited_asset'],names[0])
            self.assertEqual(p.load(entry['edited_asset']).getpixel((15,15)),(255,255,255,255))
            # Returning a preview never changes the previously applied source asset.
            self.assertEqual(p.load(names[0]).getpixel((15,15)),(20,40,60,128))

    def test_staging_batch_selection(self):
        batch=torch.stack([torch.zeros(12,16,3),torch.ones(12,16,3)])
        p.PristineSend().execute(batch,'example',1)
        import hashlib,json
        asset=json.loads((p.root()/(hashlib.sha256(b'example').hexdigest()+'.json')).read_text())['asset']
        self.assertEqual(p.load(asset).getpixel((0,0)),(255,255,255))
        with self.assertRaises(ValueError):p.PristineSend().execute(batch,'example',3)
    def test_model_companion_composite_and_modes(self):
        import sys,types
        seen=[]
        class VAEEncode:
            def encode(self,**kw):seen.append('regular');return ({'samples':kw['pixels']},)
        class Conditioning:
            def encode(self,**kw):seen.append('dedicated');return kw['positive'],kw['negative'],{'samples':kw['pixels']}
        class Decode:
            def decode(self,vae,samples):return (torch.ones_like(samples['samples']),)
        sys.modules['nodes']=types.SimpleNamespace(VAEEncodeForInpaint=VAEEncode,InpaintModelConditioning=Conditioning,VAEDecode=Decode,common_ksampler=lambda *a,**k:(a[8],))
        source=torch.zeros(1,63,77,3);mask=torch.zeros(1,63,77);mask[:,10:20,10:20]=1
        node=p.PristineModelInpaint()
        for mode in ['regular_checkpoint','dedicated_inpaint_checkpoint']:
            result=node.execute(source,mask,None,None,[],[],mode,0,1,1,'euler','normal',1,512)[0]
            self.assertEqual(result.shape,source.shape);self.assertTrue(torch.all(result[:,10:20,10:20]==1));self.assertTrue(torch.all(result[mask==0]==0))
        self.assertEqual(seen,['regular','dedicated'])
        feathered=node.execute(source,mask,None,None,[],[],'regular_checkpoint',0,1,1,'euler','normal',1,512,blend_pixels=4)[0]
        self.assertTrue(torch.all(feathered[mask==0]==0))
        self.assertGreater(feathered[0,10,10,0].item(),0)
        self.assertLess(feathered[0,10,10,0].item(),1)
        self.assertEqual(feathered[0,15,15,0].item(),1)
if __name__=='__main__':unittest.main()
