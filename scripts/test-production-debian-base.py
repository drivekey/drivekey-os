#!/usr/bin/env python3
"""Exercise real namespace write/network boundaries of the new base bootstrap."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('base', Path(__file__).with_name('bootstrap-production-debian-base.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

class Boundaries(unittest.TestCase):
    def test_only_output_writable(self):
        with tempfile.TemporaryDirectory(prefix='drivekey-boundary-', dir='/opt') as name:
            parent = Path(name)
            output = parent / 'output'
            output.mkdir()
            sentinel = parent / 'sentinel'
            sentinel.write_text('unchanged')
            code = ('from pathlib import Path; import sys; '
                    'Path(sys.argv[1]).write_text("allowed"); '
                    'Path(sys.argv[2]).write_text("forbidden")')
            result = subprocess.run(base.confined(['/usr/bin/python3', '-c', code,
                                    str(output / 'created'), str(sentinel)], output), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_text(), 'unchanged')
            self.assertEqual((output / 'created').read_text(), 'allowed')

    def test_symlink_cannot_escape_writable_bind(self):
        with tempfile.TemporaryDirectory(prefix='drivekey-boundary-', dir='/opt') as name:
            parent = Path(name)
            output = parent / 'output'
            output.mkdir()
            sentinel = parent / 'sentinel'
            sentinel.write_text('unchanged')
            (output / 'escape').symlink_to(sentinel)
            result = subprocess.run(base.confined(['/usr/bin/python3', '-c',
                'from pathlib import Path; import sys; Path(sys.argv[1]).write_text("forbidden")',
                str(output / 'escape')], output), capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_text(), 'unchanged')

    def test_network_namespace_is_separate(self):
        with tempfile.TemporaryDirectory(prefix='drivekey-boundary-', dir='/opt') as name:
            host = Path('/proc/self/ns/net').readlink()
            result = subprocess.run(base.confined(['/usr/bin/python3', '-c',
                'from pathlib import Path; print(Path("/proc/self/ns/net").readlink())'], Path(name)),
                capture_output=True, text=True, check=True)
            self.assertNotEqual(str(host), result.stdout.strip())

    def test_solver_temporary_files_stay_in_output(self):
        with tempfile.TemporaryDirectory(prefix='drivekey-boundary-',dir='/opt') as name:
            output=Path(name);state=output/'state';state.mkdir()
            result=subprocess.run(base.confined(['/usr/bin/python3','-c',
                'import tempfile; f=tempfile.NamedTemporaryFile(); f.write(b"test"); f.flush(); print(f.name)'],output),
                env=base.solver_environment(state),capture_output=True,text=True,check=True)
            self.assertTrue(Path(result.stdout.strip()).is_relative_to(output))
    def test_runtime_roots_reject_unlisted_and_apt_options(self):
        report={'packages':[{'package':'busybox','version':'1'}]}
        for names in [['busybox','busybox'],['missing'],['--allow-unauthenticated'],[]]:
            with self.subTest(names=names),self.assertRaises(ValueError):
                base.select_requested_packages(report,{'schemaVersion':1,'kind':'drivekey-production-runtime-package-roots','packages':names})
        self.assertEqual(base.select_requested_packages(report,{'schemaVersion':1,'kind':'drivekey-production-runtime-package-roots','packages':['busybox']}),report['packages'])
    def test_new_runtime_root_requires_authenticated_index_membership(self):
        report={'packages':[]};selection={'schemaVersion':1,'kind':'drivekey-production-runtime-package-roots','packages':['qrencode']}
        with self.assertRaises(ValueError):base.select_requested_packages(report,selection,set())
        self.assertEqual(base.select_requested_packages(report,selection,{'qrencode'}),[{'package':'qrencode','version':None}])
    def test_debian_version_order(self):
        self.assertEqual(base.newest(['1:2.41-5', '1:2.41.5-0+deb13u1', '2.99-1']), '1:2.41.5-0+deb13u1')

    def test_apt_solver_ignores_inherited_configuration(self):
        with tempfile.TemporaryDirectory(prefix='drivekey-boundary-',dir='/opt') as name:
            output=Path(name);state=output/'state';state.mkdir()
            malicious=output/'inherited.conf';malicious.write_text('DriveKey::Injected "unexpected";\n')
            with patch.dict('os.environ',{'APT_CONFIG':str(malicious),'LD_PRELOAD':'invalid-inherited-value'}):
                environment=base.solver_environment(state)
                result=subprocess.run(base.confined(['/usr/bin/apt-config','dump'],output),env=environment,
                    capture_output=True,text=True,check=True)
            self.assertNotIn('DriveKey::Injected',result.stdout)
            self.assertNotIn('LD_PRELOAD',environment)
            self.assertIn('Dir::Etc::main "/dev/null"',result.stdout)
            self.assertIn('Dir::Etc::parts "/nonexistent"',result.stdout)

if __name__ == '__main__':
    unittest.main()
