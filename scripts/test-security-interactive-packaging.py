#!/usr/bin/python3
"""Research payload removal is atomic with respect to all identity checks."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-security-interactive-image.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = {'entries': []}
        for name in builder.RESEARCH_PAYLOAD:
            path = self.root / 'opt/drivekey' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'research-only')
            self.manifest['entries'].append({'path': str(path.relative_to(self.root)),
                'type': 'file', 'size': 13, 'sha256': hashlib.sha256(b'research-only').hexdigest()})
        self.runtime = self.root / 'opt/drivekey/drivekey-key-worker.cjs'
        self.runtime.write_bytes(b'protected runtime')

    def test_removal_preserves_runtime_and_original_manifest(self):
        removed = builder.remove_research_payload(self.root, self.manifest)
        self.assertEqual(len(removed), 6)
        self.assertEqual(len(self.manifest['entries']), 6)
        self.assertEqual(self.runtime.read_bytes(), b'protected runtime')
        self.assertTrue(all(not (self.root / e['path']).exists() for e in removed))

    def test_changed_last_file_does_not_partially_remove(self):
        (self.root / self.manifest['entries'][-1]['path']).write_bytes(b'tamper')
        with self.assertRaisesRegex(ValueError, 'changed'):
            builder.remove_research_payload(self.root, self.manifest)
        self.assertTrue(all((self.root / e['path']).exists() for e in self.manifest['entries']))

    def test_unmanifested_entry_rejected(self):
        self.manifest['entries'].pop()
        with self.assertRaisesRegex(ValueError, 'Missing'):
            builder.remove_research_payload(self.root, self.manifest)

    def test_symlink_rejected(self):
        path = self.root / self.manifest['entries'][-1]['path']
        path.unlink()
        path.symlink_to(self.runtime)
        with self.assertRaisesRegex(ValueError, 'Missing'):
            builder.remove_research_payload(self.root, self.manifest)
        self.assertEqual(self.runtime.read_bytes(), b'protected runtime')

    def test_wrong_size_rejected(self):
        self.manifest['entries'][-1]['size'] += 1
        with self.assertRaisesRegex(ValueError, 'changed'):
            builder.remove_research_payload(self.root, self.manifest)


if __name__ == '__main__':
    unittest.main()
