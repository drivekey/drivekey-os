// Read-only artifact/evidence validation. Never opens a signer or changes the spending ledger.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {auditFullProduct,ARTIFACTS}=createRequire(import.meta.url)('./full-product-gates.cjs');
if(process.argv.length!==3)throw Error('Usage: node tools/check-full-product.mjs <evidence-manifest.json>');
const file=path.resolve(process.argv[2]),root=path.dirname(file);
if((await fs.stat(file)).size>32*1024*1024)throw Error('Evidence manifest exceeds 32 MiB.');
const input=JSON.parse(await fs.readFile(file,'utf8')),report=auditFullProduct(input);
const files=[];
for(const name of ARTIFACTS)if(input?.release?.artifacts?.[name])files.push(input.release.artifacts[name]);
for(const row of [...(Array.isArray(input?.cases)?input.cases:[]),...(Array.isArray(input?.gates)?input.gates:[])])for(const evidence of Array.isArray(row?.evidence)?row.evidence:[])files.push(evidence);
const checked=new Map();
for(const entry of files){
 try{
  if(typeof entry.path!=='string'||path.isAbsolute(entry.path)||entry.path.includes(':'))throw Error('Use a relative path inside the evidence directory.');
  const target=path.resolve(root,entry.path),relative=path.relative(root,target);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Evidence path escapes its root.');
  let current=root;
  for(const part of relative.split(path.sep)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw Error('Evidence symlinks are refused.');}
  if(!(await fs.stat(target)).isFile())throw Error('Evidence must be a regular file.');
  let hash=checked.get(target);
  if(!hash){const digest=createHash('sha256');for await(const chunk of createReadStream(target))digest.update(chunk);hash=digest.digest('hex');checked.set(target,hash);}
  if(hash!==entry.sha256)throw Error('Artifact/evidence hash mismatch.');
 }catch(error){report.failures.push({path:entry?.path??null,reason:error.message});report.evidenceComplete=false;}
}
report.checkedAt=new Date().toISOString();report.filesRehashed=checked.size;
console.log(JSON.stringify(report,null,2));
if(!report.evidenceComplete)process.exitCode=1;
