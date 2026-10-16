#!/usr/bin/env python3
"""Synthetic consistency tests only; no cryptographic signature claim."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('binding',Path(__file__).with_name('production-image-node-binding.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Binding(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.build={'sources':{n:'a'*64 for n in m.LEGACY_SOURCES},'node':{'pgpVerified':False}}
 def tearDown(self):self.tmp.cleanup()
 def modern(self):
  self.build['sources'][m.VERIFIER]='b'*64
  (self.root/m.ARCHIVE).write_bytes(b'synthetic archive')
  archive=m.sha(self.root/m.ARCHIVE);capture=self.root/'node-release-authentication';capture.mkdir()
  names=['node-readme.md','release-keys-readme.md','SHASUMS256.txt','SHASUMS256.txt.sig',m.FINGERPRINT+'.asc']
  for name in names:(capture/name).write_text(archive+'  '+m.ARCHIVE+'\n' if name=='SHASUMS256.txt' else 'synthetic test input')
  (self.root/'node-SHASUMS256.txt').write_bytes((capture/'SHASUMS256.txt').read_bytes());(capture/'retrieval.json').write_text('[]')
  self.report={'kind':'node-official-key-checksum-signature-verification','success':True,'signatureVerified':True,'fundingReady':False,'verificationNetwork':False,'defaultTrustStoreUsed':False,'assemblerChanged':True,'verificationStage':'before-archive-extraction','helperSha256':'b'*64,'version':'v22.23.3','archive':m.ARCHIVE,'archiveSha256':archive,'primaryFingerprint':m.FINGERPRINT,'firstUseTrust':'synthetic test only','inputs':{name:m.sha(capture/name) for name in names},'retrieval':[],'retrievalSha256':m.sha(capture/'retrieval.json')}
  self.build['node']={'pgpVerified':True,'version':'v22.23.3','archiveSha256':archive,'checksumFileSha256':m.sha(capture/'SHASUMS256.txt'),'verificationReport':'node-release-verification.json','signerFingerprint':m.FINGERPRINT,'firstUseTrust':'synthetic test only'};self.seal()
 def seal(self):
  p=self.root/'node-release-verification.json';p.write_text(json.dumps(self.report));self.build['node']['verificationReportSha256']=m.sha(p)
 def test_legacy(self):self.assertEqual(m._validate_consistency(self.root,self.build)['mode'],'legacy-unverified')
 def test_modern(self):self.modern();self.assertEqual(m._validate_consistency(self.root,self.build)['mode'],'recorded-signature-enforcement')
 def test_legacy_signature_claim(self):
  self.build['node']['pgpVerified']=True
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_mixed_legacy_report(self):
  (self.root/'node-release-verification.json').write_text('{}')
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_missing_source_entry(self):
  self.modern();del self.build['sources'][m.VERIFIER]
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_postbuild_report_rejected(self):
  self.modern();self.report['verificationStage']='after-build';self.seal()
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_helper_mismatch(self):
  self.modern();self.report['helperSha256']='c'*64;self.seal()
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_archive_changed(self):
  self.modern();(self.root/m.ARCHIVE).write_bytes(b'changed')
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_capture_changed(self):
  self.modern();(self.root/'node-release-authentication/SHASUMS256.txt.sig').write_bytes(b'changed')
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_report_path_rejected(self):
  self.modern();self.build['node']['verificationReport']='../report.json'
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
 def test_packaging_mixture_rejected(self):
  self.modern();e=m._validate_consistency(self.root,self.build)
  with self.assertRaises(ValueError):m.validate_packaging({},e)
  with self.assertRaises(ValueError):m.validate_packaging({'nodeVerification':e},e)
  m.validate_packaging({'nodeVerification':e,'nodeBindingHelperSha256':m.sha(m.__file__)},e)
 def test_fabricated_signature_rejected_by_public_validation(self):
  self.modern()
  with self.assertRaises(ValueError):m.validate(self.root,self.build)
 def test_arbitrary_binding_helper_hash_rejected(self):
  self.modern();e=m._validate_consistency(self.root,self.build)
  with self.assertRaises(ValueError):m.validate_packaging({'nodeVerification':e,'nodeBindingHelperSha256':'d'*64},e)
 def test_extra_capture_rejected(self):
  self.modern();(self.root/'node-release-authentication/extra').write_text('extra')
  with self.assertRaises(ValueError):m._validate_consistency(self.root,self.build)
if __name__=='__main__':unittest.main()
