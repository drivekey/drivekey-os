import hashlib, importlib.util, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('debian',Path(__file__).with_name('prepare-production-debian-prerequisites.py'))
debian=importlib.util.module_from_spec(spec);spec.loader.exec_module(debian)

class DebianTests(unittest.TestCase):
    def exercise(self,change='',wrong_hash=False,signature_failure=False):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);release=root/'InRelease';release.write_text('unit signed-message placeholder')
            index=root/'Packages';index.write_bytes(b'Package: demo\nVersion: 1\n\n');out=root/'out';out.mkdir()
            content='Origin: Debian\nCodename: trixie\nDate: Sat, 12 Sep 2026 07:55:41 UTC\n'+change+'SHA256:\n '+('0'*64 if wrong_hash else debian.sha(index))+' '+str(index.stat().st_size)+' main/binary-amd64/Packages\n'
            def verify(argv,**kwargs):
                self.assertTrue(kwargs['check'])
                if signature_failure:raise subprocess.CalledProcessError(1,argv)
                Path(argv[argv.index('--output')+1]).write_text(content)
                return subprocess.CompletedProcess(argv,0,'unit-fingerprint\n','')
            with patch.object(debian.subprocess,'run',side_effect=verify):return debian.signed_index(release,index,root/'keyring',out)
    def test_signed_index_binds_uncompressed_bytes(self):self.assertEqual(self.exercise()['indexBytes'],26)
    def test_bad_signature_is_not_accepted(self):
        with self.assertRaises(subprocess.CalledProcessError):self.exercise(signature_failure=True)
    def test_wrong_index_digest_rejected(self):
        with self.assertRaises(ValueError):self.exercise(wrong_hash=True)
    def test_expired_release_rejected(self):
        with self.assertRaises(ValueError):self.exercise('Valid-Until: Sat, 12 Sep 2020 07:55:41 UTC\n')
    def test_unexpected_origin_rejected(self):
        with self.assertRaises(ValueError):self.exercise('Origin: Other\n')
    def test_future_release_rejected(self):
        with self.assertRaises(ValueError):self.exercise('Date: Sat, 12 Sep 2099 07:55:41 UTC\n')
    def test_redirect_refused(self):
        with self.assertRaises(ValueError):debian.NoRedirect().redirect_request(None,None,302,'Found',{},'http://other.invalid')
    def test_empty_debian_control_headers(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'status';p.write_text('Package: demo\nConffiles:\n /etc/demo hash\n\n')
            self.assertEqual(list(debian.paragraphs(p))[0]['Conffiles'],'\n/etc/demo hash')
if __name__=='__main__':unittest.main()
