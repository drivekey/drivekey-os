#!/usr/bin/env python3
"""Read-only retained Node signature integration; disposable resealed tampering."""
import importlib.util,json,shutil,sys,tempfile
from pathlib import Path

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
binding=load('binding','production-image-node-binding.py');verifier=load('verifier','verify-node-release-signature.py')

def main():
 capture,archive,output=map(Path,sys.argv[1:]);project=Path(__file__).resolve().parents[1]
 with tempfile.TemporaryDirectory(prefix='drivekey-node-binding-real-') as temp:
  image=Path(temp);destination=image/'node-release-authentication';shutil.copytree(capture,destination);shutil.copyfile(archive,image/binding.ARCHIVE);shutil.copyfile(destination/'SHASUMS256.txt',image/'node-SHASUMS256.txt')
  report=verifier.verify(destination,image/binding.ARCHIVE);report.update(assemblerChanged=True,verificationStage='before-archive-extraction',helperSha256=binding.sha(verifier.__file__))
  build={'sources':{name:binding.sha(project/name) for name in binding.LEGACY_SOURCES|{binding.VERIFIER}},'node':{'version':report['version'],'archiveSha256':report['archiveSha256'],'checksumFileSha256':report['inputs']['SHASUMS256.txt'],'pgpVerified':True,'verificationReport':'node-release-verification.json','signerFingerprint':report['primaryFingerprint'],'firstUseTrust':report['firstUseTrust']}}
  def seal():
   path=image/'node-release-verification.json';path.write_text(json.dumps(report));build['node']['verificationReportSha256']=binding.sha(path)
  seal();valid=binding.validate(image,build);assert valid['signatureReverifiedOffline'] is True
  sig=destination/'SHASUMS256.txt.sig';sig.write_bytes(b'corrupt signature for negative test')
  report['inputs']['SHASUMS256.txt.sig']=binding.sha(sig)
  retrieval=json.loads((destination/'retrieval.json').read_text())
  for item in retrieval:
   if item['name']=='SHASUMS256.txt.sig':item.update(sha256=binding.sha(sig),bytes=sig.stat().st_size)
  (destination/'retrieval.json').write_text(json.dumps(retrieval));report['retrieval']=retrieval;report['retrievalSha256']=binding.sha(destination/'retrieval.json');seal()
  assert binding._validate_consistency(image,build)['mode']=='recorded-signature-enforcement'
  try:binding.validate(image,build)
  except ValueError as error:
   assert 'signature verification failed' in str(error);refusal=str(error)
  else:raise AssertionError('Cryptographically invalid resealed signature accepted')
 record={'kind':'drivekey-node-binding-real-signature-integration','validRetainedSignatureAccepted':True,'tamperedSignatureWithRecomputedEvidenceHashesRejected':True,'negativeRefusal':refusal,'archiveSha256':binding.sha(archive),'sourceHashes':{name:binding.sha(project/name) for name in ['scripts/production-image-node-binding.py','scripts/verify-node-release-signature.py','scripts/test-production-image-node-binding-real.py']},'network':False,'imageModified':False,'futureImageBuilt':False,'fundingReady':False}
 with output.open('x') as f:json.dump(record,f,indent=2)
 print(json.dumps(record))
if __name__=='__main__':main()
