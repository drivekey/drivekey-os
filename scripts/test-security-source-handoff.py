#!/usr/bin/python3
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('handoff', Path(__file__).with_name('prepare-security-source-handoff.py'))
handoff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handoff)


class SourceAllowlistTests(unittest.TestCase):
    def test_nested_node_modules_rejected(self):
        self.assertFalse(handoff.source_allowed('scripts/tool/node_modules/pkg/index.js'))

    def test_research_harnesses_rejected(self):
        for name in ['security-candidate-fullscope-tests.ts', 'security-candidate-image-tests.ts',
                     'security-candidate-smoke.ts', 'security-candidate-image-init.py',
                     'create-security-candidate-fixture.ts']:
            self.assertFalse(handoff.source_allowed('scripts/' + name), name)

    def test_runtime_and_build_source_retained(self):
        for name in ['offline-signer/signer.ts', 'scripts/build-security-interactive-image.py',
                     'scripts/security-interactive-image-init.py', 'LICENSE', 'pnpm-lock.yaml']:
            self.assertTrue(handoff.source_allowed(name), name)

    def test_traversal_and_absolute_rejected(self):
        for name in ['../core/a.ts', '/core/a.ts', 'core/../a.ts', 'core\\a.ts']:
            with self.assertRaises(ValueError):
                handoff.source_allowed(name)

    def test_unlisted_sensitive_roots_rejected(self):
        for name in ['.env', 'outputs/wallet.json', 'wallets/a.json', 'node_modules/a/index.js',
                     'core/.env', 'scripts/tool/.env.local', 'core/credentials/a.json',
                     'scripts/tool/wallet-output/a.json', 'packaging/keyfiles/a.pem',
                     'core/wallet.json', 'scripts/keypair.json', 'packaging/credentials.json']:
            self.assertFalse(handoff.source_allowed(name), name)


if __name__ == '__main__':
    unittest.main()
