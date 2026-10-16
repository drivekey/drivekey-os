import importlib.util,json,pathlib,shutil,tempfile,unittest
import http.server,threading
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('verifier',pathlib.Path(__file__).with_name('verify-node-release-signature.py'));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=ROOT/'outputs/node-release-signature-capture-20261016'
ARCHIVE=pathlib.Path('/opt/drivekey-production-images/interactive-20261016-r1792174000007')/v.ARCHIVE
class NodeSignatureTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='drivekey-node-signature-test-');self.directory=pathlib.Path(self.temp.name)/'capture';shutil.copytree(SOURCE,self.directory)
 def tearDown(self):self.temp.cleanup()
 def test_capture_refuses_redirect_before_contacting_target(self):
  visits=[]
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_GET(self):
    visits.append(self.path)
    self.send_response(302 if self.path=='/origin' else 200)
    if self.path=='/origin':self.send_header('Location','/redirected')
    self.end_headers()
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with patch.object(v,'URLS',{'test':'http://127.0.0.1:'+str(server.server_port)+'/origin'}):
    with self.assertRaisesRegex(ValueError,'Unexpected redirect'):
     v.capture(pathlib.Path(self.temp.name)/'redirect-capture')
   self.assertEqual(visits,['/origin'])
  finally:server.shutdown();server.server_close();thread.join()
 def update(self,name,data):
  (self.directory/name).write_bytes(data);records=json.loads((self.directory/'retrieval.json').read_text())
  for item in records:
   if item['name']==name:item.update(sha256=v.hashlib.sha256(data).hexdigest(),bytes=len(data))
  (self.directory/'retrieval.json').write_text(json.dumps(records))
 def test_actual_archive_and_signature(self):self.assertTrue(v.verify(self.directory,ARCHIVE)['signatureVerified'])
 def test_changed_signed_checksum_even_with_updated_capture_hash(self):
  data=(self.directory/'SHASUMS256.txt').read_bytes();self.update('SHASUMS256.txt',b'0'+data[1:])
  with self.assertRaisesRegex(ValueError,'signature verification'):v.verify(self.directory,ARCHIVE)
 def test_corrupted_signature_even_with_updated_capture_hash(self):
  data=bytearray((self.directory/'SHASUMS256.txt.sig').read_bytes());data[-8]^=1;self.update('SHASUMS256.txt.sig',bytes(data))
  with self.assertRaises(ValueError):v.verify(self.directory,ARCHIVE)
 def test_unlisted_primary_fingerprint(self):
  name='node-readme.md';self.update(name,(self.directory/name).read_bytes().replace(v.FINGERPRINT.encode(),b'0'*40))
  with self.assertRaisesRegex(ValueError,'fingerprint missing'):v.verify(self.directory,ARCHIVE)
 def test_corrupt_key_certificate(self):
  self.update(v.FINGERPRINT+'.asc',b'not a key')
  with self.assertRaises(ValueError):v.verify(self.directory,ARCHIVE)
 def test_wrong_archive_bytes(self):
  archive=pathlib.Path(self.temp.name)/v.ARCHIVE;archive.write_bytes(b'wrong archive')
  with self.assertRaisesRegex(ValueError,'Archive checksum mismatch'):v.verify(self.directory,archive)
 def test_duplicate_exact_checksum_parser(self):
  data=(self.directory/'SHASUMS256.txt').read_bytes();line=next(x for x in data.splitlines() if x.endswith(v.ARCHIVE.encode()))
  with self.assertRaisesRegex(ValueError,'Unique exact'):v.archive_checksum(data+line+b'\n')
 def test_changed_capture_without_rehash(self):
  with (self.directory/'SHASUMS256.txt').open('ab') as f:f.write(b'\n')
  with self.assertRaisesRegex(ValueError,'Retrieved bytes changed'):v.verify(self.directory,ARCHIVE)
 def test_alternate_key_origin_refused(self):
  p=self.directory/'retrieval.json';records=json.loads(p.read_text());records[-1]['url']='https://example.com/key';p.write_text(json.dumps(records))
  with self.assertRaisesRegex(ValueError,'retrieval URL'):v.verify(self.directory,ARCHIVE)
if __name__=='__main__':unittest.main()
