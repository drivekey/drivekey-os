import base64, hashlib, importlib.util, io, tarfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('verify',Path(__file__).with_name('verify-production-npm-closure.py'))
verify=importlib.util.module_from_spec(spec);spec.loader.exec_module(verify)

def archive(entries):
    target=io.BytesIO()
    with tarfile.open(fileobj=target,mode='w:gz') as out:
        for name,data,kind in entries:
            item=tarfile.TarInfo(name);item.type=kind;item.size=len(data) if kind==tarfile.REGTYPE else 0
            if kind==tarfile.SYMTYPE:item.linkname='../../outside'
            out.addfile(item,io.BytesIO(data) if kind==tarfile.REGTYPE else None)
    data=target.getvalue()
    return data,'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()

class ClosureTests(unittest.TestCase):
    def test_redirect_is_refused_before_follow(self):
        with self.assertRaises(ValueError):
            verify.NoRedirect().redirect_request(None,None,302,'Found',{},'https://other.example/package.tgz')
    def test_valid_tarball_and_exact_input(self):
        data,pin=archive([('package/a.js',b'valid',tarfile.REGTYPE)])
        verify.verify_tarball(data,pin,{'a.js':verify.digest(b'valid')})
    def test_rejects_integrity_mismatch(self):
        data,pin=archive([('package/a.js',b'valid',tarfile.REGTYPE)])
        with self.assertRaises(ValueError):verify.verify_tarball(data,pin+'x',{})
    def test_rejects_changed_installed_input(self):
        data,pin=archive([('package/a.js',b'valid',tarfile.REGTYPE)])
        with self.assertRaises(ValueError):verify.verify_tarball(data,pin,{'a.js':verify.digest(b'changed')})
    def test_rejects_duplicate_and_traversal(self):
        for names in [['package/a.js','package/a.js'],['../outside']]:
            data,pin=archive([(name,b'a',tarfile.REGTYPE) for name in names])
            with self.assertRaises(ValueError):verify.verify_tarball(data,pin,{})
    def test_rejects_consumed_symlink_and_missing_source(self):
        data,pin=archive([('package/a.js',b'',tarfile.SYMTYPE)])
        for name in ['a.js','absent.js']:
            with self.assertRaises(ValueError):verify.verify_tarball(data,pin,{name:verify.digest(b'')})
    def test_integrities_only_from_packages_mapping(self):
        text="importers:\n  fake@1:\n    resolution: {integrity: sha512-YQ==}\npackages:\n  '@example/name@1.0.0':\n    resolution: {integrity: sha512-Yg==}\nsnapshots:\n  bad@2:\n    resolution: {integrity: sha512-Yw==}\n"
        self.assertEqual(verify.parse_integrities(text),{'@example/name@1.0.0':'sha512-Yg=='})
if __name__=='__main__':unittest.main()
