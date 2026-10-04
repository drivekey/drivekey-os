import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { mkdir,mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { resolve,join,sep } from 'node:path';
const fault=vi.hoisted(()=>({rename:false}));
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return{...actual,rename:async(...args:Parameters<typeof actual.rename>)=>{if(fault.rename)throw new Error('TEST simulated disconnect before rename');return actual.rename(...args);}};
});
import { readJsonFile,writeJsonFile } from '../core/files';
let root:string;
beforeAll(async()=>{const parent=resolve('outputs/test-fixtures');await mkdir(parent,{recursive:true});root=await mkdtemp(join(parent,'files-'));});
afterAll(async()=>{if(root.startsWith(resolve('outputs/test-fixtures')+sep))await rm(root,{recursive:true,force:true});});
describe('bounded exchange file operations on test directories',()=>{
  it('never overwrites an existing vault',async()=>{await writeJsonFile(root,'vault-encrypted.json',{fixture:true});await expect(writeJsonFile(root,'vault-encrypted.json',{fixture:false})).rejects.toThrow();expect(await readJsonFile(root,'vault-encrypted.json')).toEqual({fixture:true});});
  it('preserves the prior target when an exchange write is interrupted',async()=>{await writeJsonFile(root,'unsigned-request.json',{old:true});fault.rename=true;try{await expect(writeJsonFile(root,'unsigned-request.json',{new:true},true)).rejects.toThrow('simulated disconnect');}finally{fault.rename=false;}expect(await readJsonFile(root,'unsigned-request.json')).toEqual({old:true});});
  it('rejects oversized or truncated on-disk files',async()=>{await writeFile(join(root,'signed-response.json'),' '.repeat(32769));await expect(readJsonFile(root,'signed-response.json')).rejects.toThrow('oversized');await writeFile(join(root,'signed-response.json'),'{');await expect(readJsonFile(root,'signed-response.json')).rejects.toThrow('Invalid JSON');});
  it('rejects traversal and directory payloads',async()=>{await expect(readJsonFile(root,'../private.json')).rejects.toThrow('filename');await mkdir(join(root,'directory.json'));await expect(readJsonFile(root,'directory.json')).rejects.toThrow('regular file');});
  it('writes, flushes, and reads back exact JSON',async()=>{await writeJsonFile(root,'signed-response.json',{test:'roundtrip'},true);expect(await readJsonFile(root,'signed-response.json')).toEqual({test:'roundtrip'});expect(await readFile(join(root,'signed-response.json'),'utf8')).toContain('roundtrip');});
});
