#!/usr/bin/env python3
"""Consistency binding for legacy and signature-enforced source image records."""
import hashlib,json,re,importlib.util
from pathlib import Path
LEGACY_SOURCES={'scripts/'+name for name in ['assemble-production-source-image.py','build-security-interactive-image.py','candidate-launch-policy.py','security-candidate-original-gui.py','security-interactive-image-init.py','security-interactive-storage.py','security-interactive-desktop.py','security-interactive-settings.py']}
VERIFIER='scripts/verify-node-release-signature.py'
FINGERPRINT='5BE8A3F6C8A5C01D106C0AD820B1A390B168D356'
ARCHIVE='node-v22.23.3-linux-x64.tar.xz'
AUTH_FIELDS={'verificationReport','verificationReportSha256','signerFingerprint','firstUseTrust'}
def sha(path):
 with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def require(value,message):
 if not value:raise ValueError(message)
def regular(path,maximum):
 require(path.is_file() and not path.is_symlink() and path.stat().st_size<=maximum,'Bounded regular Node evidence required')
 return path

def _validate_consistency(image,build):
 image=Path(image);sources=build.get('sources',{});node=build.get('node',{})
 require(isinstance(sources,dict) and isinstance(node,dict),'Node/source records required')
 modern=VERIFIER in sources
 require(set(sources)==LEGACY_SOURCES|({VERIFIER} if modern else set()),'Source set differs')
 if not modern:
  require(node.get('pgpVerified') is False and not AUTH_FIELDS.intersection(node),'Legacy image cannot claim signature enforcement')
  require(not (image/'node-release-verification.json').exists(),'Legacy image cannot mix a build-time signature report')
  return {'mode':'legacy-unverified','pgpVerified':False}
 require(node.get('pgpVerified') is True and AUTH_FIELDS.issubset(node),'Signature-enforced image requires all authentication fields')
 require(node['verificationReport']=='node-release-verification.json','Fixed Node report name required')
 path=regular(image/node['verificationReport'],1048576)
 require(sha(path)==node['verificationReportSha256'],'Node verification report changed')
 report=json.loads(path.read_text())
 require(report.get('kind')=='node-official-key-checksum-signature-verification' and report.get('success') is True and report.get('signatureVerified') is True,'Successful Node signature evidence required')
 require(report.get('assemblerChanged') is True and report.get('verificationStage')=='before-archive-extraction','Node authentication must precede extraction')
 require(report.get('helperSha256')==sources[VERIFIER],'Node verifier source binding differs')
 require(node.get('version')==report.get('version')=='v22.23.3' and report.get('archive')==ARCHIVE,'Exact Node version/archive required')
 require(node['signerFingerprint']==report.get('primaryFingerprint')==FINGERPRINT,'Pinned signer differs')
 require(isinstance(node['firstUseTrust'],str) and bool(node['firstUseTrust']) and node['firstUseTrust']==report.get('firstUseTrust'),'Trust qualification differs')
 require(report.get('fundingReady') is False and report.get('verificationNetwork') is False and report.get('defaultTrustStoreUsed') is False,'Verification scope differs')
 archive=regular(image/ARCHIVE,100*1024*1024);sums=regular(image/'node-SHASUMS256.txt',1048576)
 require(sha(archive)==node['archiveSha256']==report.get('archiveSha256'),'Authenticated archive differs')
 names={'node-readme.md','release-keys-readme.md','SHASUMS256.txt','SHASUMS256.txt.sig',FINGERPRINT+'.asc'}
 require(isinstance(report.get('inputs'),dict) and set(report['inputs'])==names,'Exact signature capture inputs required')
 capture=image/'node-release-authentication';require(capture.is_dir() and not capture.is_symlink(),'Regular capture directory required')
 require({p.name for p in capture.iterdir()}==names|{'retrieval.json'},'Capture set differs')
 for name in names:require(sha(regular(capture/name,1048576))==report['inputs'][name],'Captured signature input changed')
 require(sha(sums)==node['checksumFileSha256']==report['inputs']['SHASUMS256.txt'],'Checksum document differs')
 require(sha(regular(capture/'retrieval.json',1048576))==report.get('retrievalSha256'),'Retrieval record changed')
 require(json.loads((capture/'retrieval.json').read_text())==report.get('retrieval'),'Retrieval evidence differs')
 matches=[m.group(1) for line in sums.read_text().splitlines() if (m:=re.fullmatch(r'([0-9a-f]{64})  '+re.escape(ARCHIVE),line))]
 require(matches==[node['archiveSha256']],'Unique authenticated archive checksum required')
 return {'mode':'recorded-signature-enforcement','pgpVerified':True,'verificationReportSha256':sha(path),'helperSha256':sources[VERIFIER],'signerFingerprint':FINGERPRINT}

def validate(image,build):
 evidence=_validate_consistency(image,build)
 if evidence['mode']=='legacy-unverified':return evidence
 verifier=Path(__file__).with_name('verify-node-release-signature.py')
 require(not verifier.is_symlink() and sha(verifier)==build['sources'][VERIFIER],'Current trusted verifier differs from image source binding')
 spec=importlib.util.spec_from_file_location('node_offline_reverification',verifier)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 verified=module.verify(Path(image)/'node-release-authentication',Path(image)/ARCHIVE)
 report=json.loads((Path(image)/'node-release-verification.json').read_text())
 for field in ['kind','success','signatureVerified','fundingReady','version','archive','archiveSha256','primaryFingerprint','firstUseTrust','verificationNetwork','defaultTrustStoreUsed','retrieval','inputs','retrievalSha256']:
  require(verified.get(field)==report.get(field),'Offline Node signature re-verification differs: '+field)
 evidence['mode']='signature-enforced';evidence['signatureReverifiedOffline']=True
 return evidence

def validate_packaging(record,evidence):
 fields={'nodeBindingHelperSha256','nodeVerification'}
 present=fields.intersection(record)
 if evidence['mode']=='legacy-unverified' and not present:return
 require(present==fields and record['nodeVerification']==evidence,'Packaging Node verification binding differs')
 require(record['nodeBindingHelperSha256']==sha(__file__),'Packaging binding helper differs from current verified helper')
