import {createServer, IncomingMessage, ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {formatUnits} from 'ethers';
import {Pool} from 'pg';
import QRCode from 'qrcode';
import {CheckoutService,deliverWebhook} from './service';
import {SettlementVerifier} from './verifier';
import {OnlineAdapter} from '../online/adapter';
import {CHAINS,Chain} from '../engine/core/payment-intent';

async function secret(name:string){const file=process.env[name+'_FILE'];if(!file)throw Error(name+'_FILE must point to a mounted secret file.');return (await readFile(file,'utf8')).trim();}
export async function start(){
 const database=await secret('DATABASE_URL'),admin=await secret('ADMIN_TOKEN');if(admin.length<32)throw Error('Admin token must have at least 32 characters.');
 const pool=new Pool({connectionString:database,max:8});const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 await pool.query(await readFile(path.join(root,'merchant/schema.sql'),'utf8'));
 const endpoints=JSON.parse(await readFile(process.env.RPC_CONFIG_FILE||'/run/config/rpc.json','utf8'));
 const verifier=new SettlementVerifier(new OnlineAdapter(endpoints)),service=new CheckoutService(pool,(i,h)=>verifier.verify(i,h));
 const webhookURL=process.env.WEBHOOK_URL,webhookSecret=webhookURL?await secret('WEBHOOK_SECRET'):null;
 const rate=new Map<string,{count:number;until:number}>();
 function response(res:ServerResponse,code:number,body:any,type='application/json'){res.writeHead(code,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(type==='application/json'?JSON.stringify(body):body);}
 async function json(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw Error('Request too large.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 const publicInvoice=(i:any)=>({id:i.id,chain:i.chain,asset:i.asset,amount:String(i.amount),paid:String(i.paid),late:String(i.late),address:i.address,createdAt:i.created_at,expiresAt:i.expires_at,status:i.status,revision:i.revision});
 const server=createServer(async(req,res)=>{try{
  const ip=req.socket.remoteAddress||'unknown',now=Date.now();if(rate.size>10000)for(const [k,v]of rate)if(v.until<now)rate.delete(k);if(rate.size>10000)throw Error('Busy.');const r=rate.get(ip);if(r&&r.until>now){if(++r.count>120)return response(res,429,{error:'Rate limited.'});}else rate.set(ip,{count:1,until:now+60000});
  const url=new URL(req.url||'/','http://localhost');
  if(url.pathname==='/checkout/health'&&req.method==='GET'){await pool.query('SELECT 1');return response(res,200,{ok:true});}
  if(url.pathname.startsWith('/admin/')){
   const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+admin);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return response(res,401,{error:'Unauthorized.'});
   if(url.pathname==='/admin/pool'&&req.method==='POST'){const p=await json(req);if(!p||Object.keys(p).sort().join(',')!=='addresses,chain')throw Error('Only a public address pool is accepted.');await service.provision(p.chain,p.addresses);return response(res,200,{imported:true});}
   if(url.pathname==='/admin/invoices'&&req.method==='POST'){const invoice=await service.create(await json(req),String(req.headers['idempotency-key']||''));return response(res,201,{...publicInvoice(invoice),checkoutPath:'/checkout/'+invoice.public_token});}
  }
  const checkout=/^\/checkout\/([a-f0-9]{64})$/.exec(url.pathname);
  if(checkout&&req.method==='GET'){await service.get(checkout[1]);return response(res,200,await readFile(path.join(root,'merchant/public/index.html')),'text/html; charset=utf-8');}
  const route=/^\/api\/invoices\/([a-f0-9]{64})(?:\/(payment|qr|receipt))?$/.exec(url.pathname);
  if(route){const token=route[1],action=route[2];
   if(req.method==='GET'){
    const i=await service.get(token);
    if(action==='qr'){
     const c=CHAINS[i.chain as Chain],uri=c.family==='ethereum'?(i.asset==='ETH'?`ethereum:${i.address}@${(c as any).chainId}?value=${i.amount}`:`ethereum:${c.usdc}@${(c as any).chainId}/transfer?address=${i.address}&uint256=${i.amount}`):`solana:${i.address}?amount=${formatUnits(i.amount,i.asset==='USDC'?6:9)}${i.asset==='USDC'?'&spl-token='+c.usdc:''}`;
     return response(res,200,{uri,qr:await QRCode.toDataURL(uri,{width:256,margin:2})});
    }
    if(action==='receipt'){if(!['paid','overpaid'].includes(i.status))return response(res,409,{error:'A settled receipt is unavailable.'});const claims=(await pool.query('SELECT tx_hash,event_index,amount::text,chain_time,evidence FROM payment_claims WHERE invoice_id=$1 AND canonical=true AND chain_time<= $2 AND chain_time >= $3',[i.id,i.expires_at,i.created_at])).rows;return response(res,200,{...publicInvoice(i),payments:claims,issuedAt:new Date().toISOString(),note:'Verify current invoice revision. Later chain evidence may move the invoice to review.'});}
    if(!action)return response(res,200,publicInvoice(i));
   }
   if(action==='payment'&&req.method==='POST'){const p=await json(req);if(Object.keys(p).length!==1||typeof p.transactionHash!=='string')throw Error('Expected transactionHash only.');return response(res,200,publicInvoice(await service.observe(token,p.transactionHash)));}
  }
  const assets:Record<string,[string,string]>={'/checkout/assets/Inter.woff2':['ui/assets/Inter.woff2','font/woff2'],'/checkout/assets/checkout.js':['merchant/public/checkout.js','text/javascript'],'/checkout/assets/tabler.css':['ui/vendor/tabler.min.css','text/css'],'/checkout/assets/checkout.css':['merchant/public/checkout.css','text/css']};
  if(req.method==='GET'&&assets[url.pathname]){const [file,type]=assets[url.pathname];return response(res,200,await readFile(path.join(root,file)),type);}
  response(res,404,{error:'Not found.'});
 }catch{response(res,400,{error:'Request could not be completed. Payment is not considered settled. Retry status or contact the merchant.'});}});
 server.requestTimeout=30000;server.headersTimeout=15000;server.maxRequestsPerSocket=100;
 let polling=false;const timer=setInterval(async()=>{if(polling)return;polling=true;try{
  const rows=(await pool.query("SELECT * FROM invoices ORDER BY last_scanned_at ASC NULLS FIRST,created_at ASC LIMIT 100")).rows;
  for(const i of rows){try{
   const claims=(await pool.query('SELECT * FROM payment_claims WHERE invoice_id=$1',[i.id])).rows;
   // Ethereum reorg detection compares the originally accepted block to current canonical chain.
   for(const p of claims){if(CHAINS[i.chain as Chain].family==='ethereum'){
    await verifier.adapter.identity(i.chain);const block=await verifier.adapter.rpc(i.chain,'eth_getBlockByNumber',[p.evidence.blockNumber,false]);
    if(block&&block.hash!==p.evidence.blockHash)await pool.query('UPDATE payment_claims SET canonical=false WHERE chain=$1 AND tx_hash=$2 AND event_index=$3',[p.chain,p.tx_hash,p.event_index]);
   }}
   if(CHAINS[i.chain as Chain].family==='ethereum'){
    // Derive the first block by timestamp once; restart scans continue from a durable cursor.
    const saved=(await pool.query('SELECT next_block FROM invoice_scan WHERE invoice_id=$1',[i.id])).rows[0];
    const latest=await verifier.adapter.rpc(i.chain,'eth_getBlockByNumber',['finalized',false]),height=BigInt(latest.number);
    let start:bigint;
    if(saved)start=BigInt(saved.next_block);else{
     let low=0n,high=height,target=new Date(i.created_at).getTime();
     while(low<high){const mid=(low+high)/2n,b=await verifier.adapter.rpc(i.chain,'eth_getBlockByNumber',['0x'+mid.toString(16),false]);if(!b)throw Error('Archive RPC required for initial scan.');if(Number(BigInt(b.timestamp))*1000<target)low=mid+1n;else high=mid;}
     start=low;await pool.query('INSERT INTO invoice_scan(invoice_id,next_block) VALUES($1,$2) ON CONFLICT DO NOTHING',[i.id,start.toString()]);
    }
    i.scan_from=start.toString();for(const hash of start>height?[]:await verifier.discover(i))await pool.query('INSERT INTO payment_hints(invoice_id,tx_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[i.id,hash]);
    const next=start+128n<height+1n?start+128n:height+1n;await pool.query('UPDATE invoice_scan SET next_block=$2 WHERE invoice_id=$1',[i.id,next.toString()]);
   }else for(const hash of await verifier.discover(i))await pool.query('INSERT INTO payment_hints(invoice_id,tx_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',[i.id,hash]);
   const hints=(await pool.query('SELECT tx_hash FROM payment_hints WHERE invoice_id=$1 LIMIT 1000',[i.id])).rows;
   for(const hint of hints)await service.observe(i.public_token,hint.tx_hash).catch(()=>{});
   await service.refresh(i.id);
  }catch{/* RPC failures never create settlement. Next poll retries. */}finally{await pool.query('UPDATE invoices SET last_scanned_at=now() WHERE id=$1',[i.id]);}}
  if(webhookURL&&webhookSecret)for(let n=0;n<20;n++)if(!await deliverWebhook(pool,webhookURL,webhookSecret))break;
 }catch{/* bounded watch loop, health endpoint exposes database connectivity */}finally{polling=false;}},30000);
 server.listen(Number(process.env.PORT||8080),process.env.BIND_ADDRESS||'0.0.0.0');
 const close=()=>{clearInterval(timer);server.close(()=>void pool.end());};process.once('SIGTERM',close);process.once('SIGINT',close);
 console.log('DriveKey watch-only checkout listening. No private signing material is accepted.');return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start().catch(()=>{console.error('Checkout startup failed. Check mounted config, secrets and PostgreSQL.');process.exitCode=1;});
