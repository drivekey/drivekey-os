import 'server-only';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {validateAlertDocument,type AlertCheckpointStore,type AlertDocument} from './durable-service-alerts';
export class PostgresAlertCheckpointStore implements AlertCheckpointStore{
 private readonly sql:NeonQueryFunction<false,false>;
 constructor(url:string,private readonly scope:string){
  const u=new URL(url);
  if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname.endsWith('.neon.tech')||!/^[a-zA-Z0-9_-]{1,80}$/.test(scope))throw Error('Invalid private alert storage configuration.');
  this.sql=neon(url);
 }
 private async query(s:string,p:unknown[]){
  try{return await this.sql.query(s,p,{fetchOptions:{signal:AbortSignal.timeout(5000)}});}catch{throw Error('Alert storage unavailable; monitoring state is unknown.');}
 }
 async read(){
  const rows=await this.query('select revision::text,document from drivekey_monitor.checkpoint where scope=$1',[this.scope]);
  if(!rows.length)return null;
  const revision=Number(rows[0].revision);
  if(rows.length!==1||!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid stored alert revision.');
  return {revision,document:validateAlertDocument(rows[0].document)};
 }
 async compareAndSwap(expectedRevision:number,next:AlertDocument){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)throw Error('Invalid expected alert revision.');
  const body=JSON.stringify(validateAlertDocument(next));
  const rows=expectedRevision===0
   ?await this.query('insert into drivekey_monitor.checkpoint(scope,revision,document) values($1,1,$2::jsonb) on conflict do nothing returning revision::text',[this.scope,body])
   :await this.query('update drivekey_monitor.checkpoint set revision=revision+1,document=$3::jsonb where scope=$1 and revision=$2 returning revision::text',[this.scope,expectedRevision,body]);
  if(!rows.length)return false;
  if(rows.length!==1||Number(rows[0].revision)!==expectedRevision+1)throw Error('Ambiguous alert commit acknowledgement.');
  return true;
 }
}
