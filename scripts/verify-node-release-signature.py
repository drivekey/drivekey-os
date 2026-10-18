#!/usr/bin/python3
"""Host-only Node v22.23.3 signature evidence; no assembler or trust-store mutation.

--capture NEW_DIRECTORY: fetch five explicitly allowed official HTTPS files.
CAPTURE_DIRECTORY ARCHIVE NEW_REPORT: offline verification in a network namespace.
"""
import datetime, hashlib, json, pathlib, re, subprocess, sys, urllib.request

FINGERPRINT='5BE8A3F6C8A5C01D106C0AD820B1A390B168D356'
ARCHIVE='node-v22.23.3-linux-x64.tar.xz'
URLS={
 'node-readme.md':'https://raw.githubusercontent.com/nodejs/node/main/README.md',
 'release-keys-readme.md':'https://raw.githubusercontent.com/nodejs/release-keys/main/README.md',
 'SHASUMS256.txt':'https://nodejs.org/dist/v22.23.3/SHASUMS256.txt',
 'SHASUMS256.txt.sig':'https://nodejs.org/dist/v22.23.3/SHASUMS256.txt.sig',
 FINGERPRINT+'.asc':'https://raw.githubusercontent.com/nodejs/release-keys/main/keys/'+FINGERPRINT+'.asc',
}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  raise ValueError('Unexpected redirect')
def require(value,message):
 if not value: raise ValueError(message)
def digest(p):
 with pathlib.Path(p).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def bounded(p,limit=1048576):
 require(p.is_file() and not p.is_symlink() and p.stat().st_size<=limit,'Bounded regular input required')
 return p.read_bytes()
def isolated(args):
 return subprocess.run(['/usr/bin/bwrap','--ro-bind','/','/','--dev','/dev','--proc','/proc','--unshare-net','--die-with-parent','--clearenv','--setenv','HOME','/nonexistent','--setenv','PATH','/usr/bin:/bin','--setenv','LC_ALL','C','--',*args],capture_output=True,text=True,timeout=30)
def capture(out):
 out.mkdir(parents=True,exist_ok=False);records=[]
 for name,url in URLS.items():
  with urllib.request.build_opener(NoRedirect()).open(url,timeout=30) as response:
   require(response.url==url,'Unexpected redirect');data=response.read(1048577);require(len(data)<=1048576,'Fetch size limit')
   records.append({'name':name,'url':url,'finalURL':response.url,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
  (out/name).write_bytes(data)
 (out/'retrieval.json').write_text(json.dumps(records,indent=2)+'\n')
def archive_checksum(data):
 matches=[m.group(1) for line in data.decode('ascii').splitlines() if (m:=re.fullmatch(r'([0-9a-f]{64})  '+re.escape(ARCHIVE),line))]
 require(len(matches)==1,'Unique exact archive checksum required')
 return matches[0]
def verify(directory,archive):
 require(archive.name==ARCHIVE,'Exact archive name required')
 require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size<=100*1024*1024,'Bounded archive required')
 data={name:bounded(directory/name) for name in URLS}
 retrieval=json.loads(bounded(directory/'retrieval.json'))
 require(len(retrieval)==len(URLS),'Retrieval record count')
 require({r['name'] for r in retrieval}==set(URLS),'Retrieval names')
 for r in retrieval:
  require(r['url']==URLS[r['name']] and r['finalURL']==r['url'],'Official retrieval URL required')
  require(hashlib.sha256(data[r['name']]).hexdigest()==r['sha256'] and len(data[r['name']])==r['bytes'],'Retrieved bytes changed')
 for name in ('node-readme.md','release-keys-readme.md'):
  require(re.search(r'\* \*\*Antoine du Hamel\*\*[^\n]*\n  \[?`'+FINGERPRINT+r'`',data[name].decode()) is not None,'Pinned full fingerprint missing from official guidance')
 key=directory/(FINGERPRINT+'.asc')
 inspected=isolated(['/usr/bin/sq','--cert-store=none','--key-store=none','inspect',str(key)])
 require(inspected.returncode==0,'Certificate inspection failed')
 require(re.findall(r'^\s*Fingerprint:\s*([A-F0-9]+)\s*$',inspected.stdout,re.M)==[FINGERPRINT],'Exact single primary certificate required')
 verified=isolated(['/usr/bin/sqv','--keyring',str(key),'--signature-file',str(directory/'SHASUMS256.txt.sig'),str(directory/'SHASUMS256.txt')])
 require(verified.returncode==0 and verified.stdout.strip()==FINGERPRINT,'Pinned checksum signature verification failed')
 archive_hash=digest(archive);require(archive_hash==archive_checksum(data['SHASUMS256.txt']),'Archive checksum mismatch')
 return {'kind':'node-official-key-checksum-signature-verification','success':True,'fundingReady':False,'version':'v22.23.3','archive':ARCHIVE,'archiveSha256':archive_hash,'primaryFingerprint':FINGERPRINT,'signatureVerified':True,'firstUseTrust':'Official Node HTTPS guidance plus exact full fingerprint; no independent out-of-band identity authentication','verificationNetwork':False,'defaultTrustStoreUsed':False,'assemblerChanged':False,'retrieval':retrieval,'inputs':{name:hashlib.sha256(value).hexdigest() for name,value in data.items()},'retrievalSha256':digest(directory/'retrieval.json'),'toolHashes':{p:digest(p) for p in ['/usr/bin/sq','/usr/bin/sqv','/usr/bin/bwrap']},'sqvVersion':subprocess.check_output(['/usr/bin/sqv','--version'],text=True).strip(),'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Authenticates checksum signature under officially listed key and exact archive bytes. Does not establish reproducible source build, independent signer identity or DriveKey release authentication.'}
def main():
 if len(sys.argv)==3 and sys.argv[1]=='--capture':capture(pathlib.Path(sys.argv[2]).absolute());return
 require(len(sys.argv)==4,'CAPTURE_DIRECTORY ARCHIVE NEW_REPORT required')
 directory,archive,out=map(lambda s:pathlib.Path(s).absolute(),sys.argv[1:]);require(not out.exists(),'New report required')
 result=verify(directory,archive);result['helperSha256']=digest(__file__)
 with out.open('x') as f:f.write(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'success':True,'fingerprint':FINGERPRINT,'archiveSha256':result['archiveSha256']}))
if __name__=='__main__':main()
