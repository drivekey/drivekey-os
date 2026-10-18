import {test,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareReleaseReview} from '../scripts/prepare-release-review-request';
import {releaseSigningBytes} from '../core/release-auth';
async function fixture(run:(c:any,d:string)=>Promise<void>){
 const d=await mkdtemp(join(tmpdir(),'drivekey-public-review-'));try{
  const assets=[];for(const role of ['payload','source','evidence']){const bytes=Buffer.from('public-test-'+role),name=role+'.bin',path=join(d,name);await writeFile(path,bytes);assets.push({role,name,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  const config={sourceCommit:'a'.repeat(40),sourceClosure:'partial',assets,manifest:{kind:'drivekey-authenticated-release',version:1,product:'drivekey-offline',hardwareRevision:'review-only',channel:'candidate',releaseVersion:'2026.10.16',sequence:1,minimumBootVersion:0,payloadBytes:assets[0].bytes,payloadSha256:assets[0].sha256,sourceSha256:assets[1].sha256,createdAt:'2026-10-16T00:00:00Z',expiresAt:'2026-10-17T00:00:00Z'}};
  await run(config,d);
 }finally{await rm(d,{recursive:true,force:true});}
}
test('matches existing signing format without creating authority or private material',()=>fixture(async(c,d)=>{const out=join(d,'packet'),r=await prepareReleaseReview(c,out);expect(await readFile(join(out,'signing-bytes.bin'))).toEqual(releaseSigningBytes(c.manifest));expect(r).toMatchObject({authenticatedRelease:false,installationAuthorized:false,fundingReady:false,independentReviewCompleted:false,approvalRequestReady:false});expect(JSON.stringify(r)).not.toContain(d);await expect(prepareReleaseReview(c,out)).rejects.toThrow();}));
test('rejects payload bytes changed without size change',()=>fixture(async(c,d)=>{await writeFile(c.assets[0].path,Buffer.alloc(c.assets[0].bytes));await expect(prepareReleaseReview(c,join(d,'packet'))).rejects.toThrow('Asset hash');}));
test('rejects substituting a different source bundle',()=>fixture(async(c,d)=>{c.manifest.sourceSha256='b'.repeat(64);await expect(prepareReleaseReview(c,join(d,'packet'))).rejects.toThrow('does not bind');}));
test('rejects production channel and duplicate case-insensitive names',()=>fixture(async(c,d)=>{c.manifest.channel='production';await expect(prepareReleaseReview(c,join(d,'p1'))).rejects.toThrow('candidate');c.manifest.channel='candidate';c.assets[2].name=c.assets[0].name.toUpperCase();await expect(prepareReleaseReview(c,join(d,'p2'))).rejects.toThrow('Duplicate');}));
test('rejects extra manifest fields and invalid metadata lifetime',()=>fixture(async(c,d)=>{c.manifest.fundingReady=true;await expect(prepareReleaseReview(c,join(d,'p1'))).rejects.toThrow();delete c.manifest.fundingReady;c.manifest.expiresAt='2026-10-15T00:00:00Z';await expect(prepareReleaseReview(c,join(d,'p2'))).rejects.toThrow('lifetime');}));
test('rejects ambiguous payload/source roles',()=>fixture(async(c,d)=>{c.assets[2].role='source';await expect(prepareReleaseReview(c,join(d,'packet'))).rejects.toThrow('Exactly one');}));
