import {Connection,type Commitment} from '@solana/web3.js';
// Two approved ProgramData accounts can each approach the existing 10 MB guard
// limit: base64 + envelope fits below 32 MiB. Larger responses fail closed.
export const SOLANA_RPC_RESPONSE_LIMIT=32*1024*1024;
export const SOLANA_RPC_FAILURE='Solana RPC could not verify the operation. Reconcile any saved signature before submitting again.';
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function boundedSolanaFetch(fetcher:typeof fetch=fetch):typeof fetch{
 return async(input,init)=>{
  let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const controller=new AbortController();
  try{
   if(typeof init?.body!=='string'||Buffer.byteLength(init.body)>1024*1024)throw Error();
   const request:unknown=JSON.parse(init.body);
   if(!object(request)||request.jsonrpc!=='2.0'||!['string','number'].includes(typeof request.id)||typeof request.method!=='string')throw Error();
   const work=async()=>{
    const response=await fetcher(input,{...init,cache:'no-store',redirect:'error',signal:controller.signal});
    if(!response.ok||response.redirected||!response.body){void response.body?.cancel().catch(()=>{});throw Error();}
    const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>SOLANA_RPC_RESPONSE_LIMIT)){void response.body.cancel().catch(()=>{});throw Error();}
    reader=response.body.getReader();const parts:Uint8Array[]=[];let count=0;
    for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>SOLANA_RPC_RESPONSE_LIMIT)throw Error();parts.push(value);}
    const bytes=new Uint8Array(count);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
    const payload:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!object(payload)||payload.jsonrpc!=='2.0'||payload.id!==request.id||!Object.hasOwn(payload,'result')||Object.hasOwn(payload,'error'))throw Error();
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:payload.result}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
   };
   return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},15000);})]);
  }catch{throw Error(SOLANA_RPC_FAILURE);}
  finally{if(timer)clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
 };
}
export function serverSolanaConnection(endpoint:string,commitment:Commitment='confirmed',fetcher:typeof fetch=fetch):Connection{
 try{
  const url=new URL(endpoint);if(!['https:','http:'].includes(url.protocol))throw Error();
  const connection=new Connection(endpoint,{commitment,disableRetryOnRateLimit:true,fetch:boundedSolanaFetch(fetcher)});
  // SDK decoding and its method-specific error wrappers must not echo untrusted
  // provider values, logs or private endpoint URLs into the route's error reply.
  return new Proxy(connection,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args:unknown[])=>{try{const result=Reflect.apply(value,target,args);return result instanceof Promise?result.catch(()=>{throw Error(SOLANA_RPC_FAILURE);}):result;}catch{throw Error(SOLANA_RPC_FAILURE);}};}});
 }catch{throw Error('Invalid private Solana RPC configuration.');}
}

