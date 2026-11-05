import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function fingerprint(root){const files={};async function walk(directory,prefix){for(const e of(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(e.isSymbolicLink())throw Error('No symlinks in source.');const relative=prefix+'/'+e.name;if(e.isDirectory())await walk(path.join(directory,e.name),relative);else if(!/\.png$/.test(e.name)||prefix.startsWith('ui'))files[relative]=createHash('sha256').update(await readFile(path.join(directory,e.name))).digest('hex');}}
 for(const dir of ['engine','online','merchant','contracts','tools','tests','ui','vendor'])await walk(path.join(root,dir),dir);
 for(const name of ['main.cjs','preload.cjs','preparation-import.cjs','market-data.cjs','account-balances.cjs','transaction-summary.cjs','ui-routes-main.cjs','ui-assets.json','signer.ts','worker.ts','receive.ts','wallet-store.cjs','signature-store.cjs','transaction-store.cjs','web-links.cjs','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','build.mjs','package-windows.mjs','release.mjs','tsconfig.json'])files[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
 return {fingerprint:createHash('sha256').update(JSON.stringify(files)).digest('hex'),sourceHashes:files};}
