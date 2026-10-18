import {beforeAll,describe,it,expect,vi} from 'vitest';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {multiOfflineAction,MULTI_FILES} from '../offline-signer/multi-service';
import {readJsonFile,writeJsonFile} from '../core/files';
vi.mock('../offline-signer/environment',()=>({assertOfflineEnvironment:vi.fn(async()=>{})}));
let root:string;const phrase='unfunded multi files isolated fixture';
beforeAll(async()=>{const parent=resolve('outputs/test-fixtures');await mkdir(parent,{recursive:true});root=await mkdtemp(join(parent,'multi-files-'));});
describe.sequential('multi-vault storage with test-only environment guard',()=>{
 it('rejects confirmation mismatch without creating files',async()=>{await expect(multiOfflineAction({scope:'multi',action:'create',password:phrase,confirmation:'wrong',consent:true},root)).rejects.toThrow('differ');await expect(readJsonFile(root,MULTI_FILES.vault)).rejects.toThrow();});
 it('creates public and encrypted files without returning secrets',async()=>{const result=await multiOfflineAction({scope:'multi',action:'create',password:phrase,confirmation:phrase,consent:true},root);const inspect=(value:unknown):void=>{if(typeof value==='string'){expect(value).not.toContain(phrase);return;}if(value&&typeof value==='object'){for(const [key,child]of Object.entries(value)){expect(key).not.toMatch(/ciphertext|privateKey|passphrase|password|secretKey|mnemonic|seed/i);inspect(child);}}};inspect(result);await expect(readJsonFile(root,'vault-encrypted.json')).rejects.toThrow();});
 it('backs up and restores both identities to an empty target',async()=>{await multiOfflineAction({scope:'multi',action:'backup',password:phrase},root);await multiOfflineAction({scope:'multi',action:'check-backup',password:phrase},root);const recovery=join(root,'recovery');await mkdir(recovery);await writeJsonFile(recovery,MULTI_FILES.backup,await readJsonFile(root,MULTI_FILES.backup));await multiOfflineAction({scope:'multi',action:'restore',password:phrase,consent:true},recovery);expect(await readJsonFile(recovery,MULTI_FILES.public)).toEqual(await readJsonFile(root,MULTI_FILES.public));});
 it('never overwrites existing vaults or backups',async()=>{await expect(multiOfflineAction({scope:'multi',action:'create',password:phrase,confirmation:phrase,consent:true},root)).rejects.toThrow('overwritten');await expect(multiOfflineAction({scope:'multi',action:'backup',password:phrase},root)).rejects.toThrow();});
});
