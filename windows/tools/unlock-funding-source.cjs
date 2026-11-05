'use strict';
// One local hidden prompt. This ONLY provisions DPAPI access; it never signs or networks.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {dpapi,worker,write,json,directory,lock,assertRequalificationSafe}=require('./protected-test-profile.cjs');
const {createHiddenTerminal}=require('../dist/hidden-input.cjs');
const expected='0xFEA3f1c9Fe066aEEf4Ec4CE18DCc3aF2B2621ADD';
const original=process.env.DRIVEKEY_LEGACY_FUNDING_DIRECTORY;
async function run(){
 if(!original||!path.isAbsolute(original))throw Error('Set DRIVEKEY_LEGACY_FUNDING_DIRECTORY to an authorized local funding directory.');
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Open the local interactive launcher.');
 const dir=directory(process.argv[2]),unlock=await lock(dir);let terminal,secret;
 try{
  const state=json(path.join(dir,'ledger.json'));assertRequalificationSafe(state);if(json(path.join(dir,'public.json')).fixtureOnly===true)throw Error('Existing funding access cannot be provisioned into a synthetic fixture profile.');
  if(fs.existsSync(path.join(dir,'funding.unlock.dpapi')))throw Error('Funding access is already provisioned.');
  const bytes=fs.readFileSync(path.join(original,'vault-encrypted.json')),receipt=json(path.join(original,'PROVISIONING-RECEIPT.json')),vault=JSON.parse(bytes);
  if(vault.public.evmAddress!==expected||createHash('sha256').update(bytes).digest('hex')!==receipt.vaultSHA256)throw Error('Original public identity or encrypted vault hash mismatch.');
  console.log('Unlock existing disposable ETH funding source '+expected+' for this bounded acceptance session.\nThe passphrase is hidden. It is protected with Windows DPAPI for later isolated signing.\nNo transaction will be signed or sent by this unlock step.');
  terminal=createHiddenTerminal();secret=await terminal.read('Existing DriveKey test-vault passphrase (hidden): ');terminal.close();terminal=undefined;
  const result=worker({action:'verify',vault,password:secret});if(!result.verified||result.public.evmAddress!==expected)throw Error('Vault verification rejected.');
  write(path.join(dir,'funding.vault.json'),bytes);write(path.join(dir,'funding.unlock.dpapi'),dpapi('protect',Buffer.from(secret)));secret=undefined;
  const identity=json(path.join(dir,'public.json'));identity.fundingSource=vault.public;write(path.join(dir,'public.json'),JSON.stringify(identity));
  console.log('Protected funding access verified. No signature or broadcast created. Return to the chat; autonomous checks can now use this disposable source within the existing limits.');
 }finally{secret=undefined;terminal?.close();await unlock();}
}
run().catch(()=>{console.error('Unlock was not completed. No secret values were logged. Original vault and historical pilot were preserved.');process.exitCode=1;});
