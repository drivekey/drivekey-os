#!/usr/bin/env python3
"""Reject altered, extra, and symlink-traversing source-base inputs."""
import importlib.util
from pathlib import Path
import tempfile
import json
import shutil
from unittest.mock import patch
import subprocess
from types import SimpleNamespace
import unittest
spec=importlib.util.spec_from_file_location('assembler',Path(__file__).with_name('assemble-production-source-image.py'))
assembler=importlib.util.module_from_spec(spec);spec.loader.exec_module(assembler)

class Inputs(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.path=self.root/'original';self.path.write_bytes(b'original');self.path.chmod(0o644)
        self.entries=[{'path':'original','mode':0o644,'type':'file','bytes':8,'sha256':assembler.sha(self.path)}]
    def tearDown(self):self.tmp.cleanup()
    def node_capture(self, directory):
        directory.mkdir()
        (directory/'SHASUMS256.txt').write_text('test checksum')
    def node_fetch(self, url, archive, maximum):
        archive.write_bytes(b'disposable archive')
    def test_node_authentication_failure_produces_no_acceptance_report(self):
        with patch.object(assembler.node_verifier,'capture',side_effect=self.node_capture), patch.object(assembler,'fetch',side_effect=self.node_fetch), patch.object(assembler.node_verifier,'verify',side_effect=ValueError('invalid signature')):
            with self.assertRaisesRegex(ValueError,'invalid signature'):
                assembler.verified_node_archive(self.root)
        self.assertFalse((self.root/'node-release-verification.json').exists())
        self.assertFalse((self.root/'node-SHASUMS256.txt').exists())
    def test_node_false_verification_is_not_accepted(self):
        with patch.object(assembler.node_verifier,'capture',side_effect=self.node_capture), patch.object(assembler,'fetch',side_effect=self.node_fetch), patch.object(assembler.node_verifier,'verify',return_value={'success':True,'signatureVerified':False}):
            with self.assertRaisesRegex(ValueError,'authentication required'):
                assembler.verified_node_archive(self.root)
        self.assertFalse((self.root/'node-release-verification.json').exists())
    def test_node_archive_change_after_verification_is_rejected(self):
        with patch.object(assembler.node_verifier,'capture',side_effect=self.node_capture), patch.object(assembler,'fetch',side_effect=self.node_fetch), patch.object(assembler.node_verifier,'verify',return_value={'success':True,'signatureVerified':True,'archiveSha256':'0'*64}):
            with self.assertRaisesRegex(ValueError,'archive changed'):
                assembler.verified_node_archive(self.root)
        self.assertFalse((self.root/'node-release-verification.json').exists())
    def test_node_success_retains_bound_verification_before_extraction(self):
        def verify(directory, archive):
            return {'success':True,'signatureVerified':True,'archiveSha256':assembler.sha(archive),'assemblerChanged':False}
        with patch.object(assembler.node_verifier,'capture',side_effect=self.node_capture), patch.object(assembler,'fetch',side_effect=self.node_fetch), patch.object(assembler.node_verifier,'verify',side_effect=verify):
            archive,sums,report,result=assembler.verified_node_archive(self.root)
        saved=json.loads(report.read_text())
        self.assertEqual(saved['archiveSha256'],assembler.sha(archive))
        self.assertEqual(saved['verificationStage'],'before-archive-extraction')
        self.assertTrue(saved['assemblerChanged'])
        self.assertEqual(sums.read_text(),'test checksum')
        self.assertEqual(saved['helperSha256'],assembler.sha(Path(assembler.node_verifier.__file__)))
    def test_node_retained_r8_archive_passes_real_signature_in_build_namespace(self):
        staging=self.root/'stage';staging.mkdir()
        args=SimpleNamespace(base=self.root,payload=self.root,output=Path('/opt/drivekey-production-images/unused'))
        command=assembler.confined_command(Path(assembler.__file__),args,staging)
        code='''import importlib.util, pathlib, shutil, sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('assembly',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
output=pathlib.Path('/opt/drivekey-production-images')
capture=m.PROJECT/'outputs/node-release-signature-capture-20261016'
archive=pathlib.Path('/opt/drivekey-production-images/retained-r8')/m.node_verifier.ARCHIVE
with patch.object(m.node_verifier,'capture',side_effect=lambda dest:shutil.copytree(capture,dest)), patch.object(m,'fetch',side_effect=lambda url,dest,maximum:shutil.copyfile(archive,dest)):
 result=m.verified_node_archive(output)
assert result[3]['signatureVerified'] is True
assert result[3]['archiveSha256']=='df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de'
'''
        # Preserve a read-only alias before the production output mount hides it.
        (staging/'retained-r8').mkdir()
        split=command.index('--')
        command=command[:split]+['--ro-bind','/opt/drivekey-production-images/interactive-20261016-r1792174000008','/opt/drivekey-production-images/retained-r8']+['--','/usr/bin/python3','-I','-B','-c',code,str(Path(assembler.__file__))]
        result=subprocess.run(command,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(json.loads((staging/'node-release-verification.json').read_text())['signatureVerified'])
    def test_valid_then_changed(self):
        assembler.checked_files(self.root,self.entries)
        self.path.write_bytes(b'modified')
        with self.assertRaises(ValueError):assembler.checked_files(self.root,self.entries)
    def test_unlisted_file(self):
        (self.root/'extra').write_bytes(b'extra')
        with self.assertRaises(ValueError):assembler.checked_files(self.root,self.entries)
    def test_symlink_parent(self):
        (self.root/'link').symlink_to(self.root,target_is_directory=True)
        self.entries[0]['path']='link/original'
        with self.assertRaises(ValueError):assembler.checked_files(self.root,self.entries)
    def test_traversal(self):
        self.entries[0]['path']='../original'
        with self.assertRaises(ValueError):assembler.checked_files(self.root,self.entries)

    def test_namespace_blocks_base_symlink_write_escape(self):
        staging=self.root/'stage';staging.mkdir()
        outside=self.root/'outside';outside.mkdir()
        sentinel=outside/'sentinel';sentinel.write_text('unchanged')
        (staging/'escape').symlink_to(outside,target_is_directory=True)
        args=SimpleNamespace(base=self.root,payload=self.root,output=Path('/opt/drivekey-production-images/unused'))
        command=assembler.confined_command(Path(assembler.__file__),args,staging)
        command=command[:command.index('--')+1]+['/usr/bin/python3','-I','-B','-c',
            'from pathlib import Path; Path("/opt/drivekey-production-images/escape/sentinel").write_text("escape")']
        result=subprocess.run(command,capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(sentinel.read_text(),'unchanged')

    def test_namespace_permits_only_new_output_and_clears_environment(self):
        staging=self.root/'stage';staging.mkdir()
        args=SimpleNamespace(base=self.root,payload=self.root,output=Path('/opt/drivekey-production-images/unused'))
        command=assembler.confined_command(Path(assembler.__file__),args,staging)
        command=command[:command.index('--')+1]+['/usr/bin/python3','-I','-B','-c',
            'import os;from pathlib import Path; assert "DRIVEKEY_TEST_SENTINEL" not in os.environ; Path("/opt/drivekey-production-images/created").write_text("allowed")']
        result=subprocess.run(command,env={'PATH':'/usr/bin:/bin','DRIVEKEY_TEST_SENTINEL':'not-inherited'},capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((staging/'created').read_text(),'allowed')

    def test_relative_escape_and_original_staging_alias_are_readonly(self):
        staging=self.root/'stage';staging.mkdir()
        (staging/'escape').symlink_to('../../tmp',target_is_directory=True)
        args=SimpleNamespace(base=self.root,payload=self.root,output=Path('/opt/drivekey-production-images/unused'))
        command=assembler.confined_command(Path(assembler.__file__),args,staging)
        code=('from pathlib import Path; import sys; '
              'targets=[Path("/opt/drivekey-production-images/escape/drivekey-review-forbidden"),Path(sys.argv[1])/"alias-write"]; '
              '\nfor target in targets:\n try: target.write_text("forbidden")\n except OSError: pass\n else: raise AssertionError(str(target))')
        command=command[:command.index('--')+1]+['/usr/bin/python3','-I','-B','-c',code,str(staging)]
        result=subprocess.run(command,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse((staging/'alias-write').exists())

    def test_absolute_pruning_link_cannot_unlink_host_file(self):
        staging=self.root/'stage';staging.mkdir()
        outside=self.root/'outside';outside.mkdir();sentinel=outside/'rule';sentinel.write_text('unchanged')
        (staging/'rules').symlink_to(outside,target_is_directory=True)
        args=SimpleNamespace(base=self.root,payload=self.root,output=Path('/opt/drivekey-production-images/unused'))
        command=assembler.confined_command(Path(assembler.__file__),args,staging)
        command=command[:command.index('--')+1]+['/usr/bin/python3','-I','-B','-c',
            'from pathlib import Path; next(Path("/opt/drivekey-production-images/rules").glob("*")).unlink()']
        result=subprocess.run(command,capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(sentinel.read_text(),'unchanged')

    def test_runtime_argument_survives_confined_cli(self):
        staging=self.root/'stage';staging.mkdir()
        runtime=self.root/'runtime'
        args=SimpleNamespace(base=self.root,payload=self.root,output=Path('/opt/drivekey-production-images/unused'),runtime_base=runtime)
        command=assembler.confined_command(Path(assembler.__file__),args,staging)
        child=command[command.index('-c')+3:]
        with patch('sys.argv',['assembler',*child]):
            parsed=assembler.arguments()
        self.assertEqual(parsed.runtime_base,runtime)
        self.assertEqual(parsed.base,args.base)

    def test_runtime_inventory_detects_changed_bytes(self):
        base=self.root/'runtime';rootfs=base/'rootfs';rootfs.mkdir(parents=True)
        item=rootfs/'runtime';item.write_bytes(b'accepted');item.chmod(0o644)
        inventory=base/'rootfs-contents.json'
        inventory.write_text(json.dumps({'entries':[{'path':'runtime','mode':0o644,'type':'file','bytes':8,'sha256':assembler.sha(item)}]}))
        report=base/'production-base.json'
        report.write_text(json.dumps({'kind':'drivekey-new-production-debian-base','fundingReady':False,'rootfsInventorySha256':assembler.sha(inventory)}))
        self.assertEqual(assembler.verified_base(base),base)
        item.write_bytes(b'altered!')
        with self.assertRaises(ValueError):assembler.verified_base(base)
if __name__=='__main__':unittest.main()

