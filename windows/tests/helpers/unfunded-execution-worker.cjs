'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process'),{digest}=require('./unfunded-execution-policy.cjs');
const root=path.resolve(__dirname,'../..'),profiles=new Map();
function worker(job){const profileId=job.action==='create'?undefined:profiles.get(digest(job.vault));if(job.action!=='create'&&!profileId)throw Error('Only fresh fixture vaults created by this harness are permitted.');
 const p=spawnSync(process.execPath,['--no-addons','--require',path.join(root,'tests/offline-network-deny.cjs'),path.join(__dirname,'unfunded-execution-child.cjs')],{input:JSON.stringify({job,profileId}),encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2*1024*1024,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,LOCALAPPDATA:process.env.LOCALAPPDATA,TEMP:process.env.TEMP,TMP:process.env.TMP}});
 let response;try{response=JSON.parse(p.stdout);}catch{throw Error('Local signer rejected the unfunded fixture operation.');}if(p.status||!response.ok)throw Error(response.error||'Local signer rejected the unfunded fixture operation.');if(job.action==='create')profiles.set(digest(response.result),response.profileId);return response.result;
}
function child(file,job,offline=true){if(file==='worker.cjs')return worker(job);return require('./hinkal-proof-session.cjs').child(file,job,offline);}
module.exports={worker,child};
