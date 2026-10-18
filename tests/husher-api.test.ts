import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {inspectHusherAccess} from '../core/husher-api';
describe('documented Husher read-only access boundary',()=>{
 it('refuses missing configuration before any request',async()=>{const f=vi.fn();await expect(inspectHusherAccess(undefined,f)).rejects.toThrow('private server');expect(f).not.toHaveBeenCalled();});
 it('uses the documented host/header without certifying routes or privacy',async()=>{const f=vi.fn(async()=>new Response(JSON.stringify({success:true,data:[]})));expect(await inspectHusherAccess('synthetic-api-credential',f)).toMatchObject({authenticated:true,privacyEnabled:false,ordersEnabled:false,certifiedRoutes:[]});expect(f).toHaveBeenCalledWith('https://api.husher.net/api/v1/husher/currencies',expect.objectContaining({method:'GET',redirect:'error',headers:{'x-api-key':'synthetic-api-credential',accept:'application/json'}}));});
 it('never propagates a provider error that may echo credentials',async()=>{await expect(inspectHusherAccess('synthetic-api-credential',async()=>{throw Error('synthetic-api-credential');})).rejects.toThrow('No order');await expect(inspectHusherAccess('synthetic-api-credential',async()=>new Response('synthetic-api-credential',{status:401}))).rejects.toThrow('permissions');});
 it('refuses unsuccessful, malformed and oversized results',async()=>{for(const text of ['not-json',JSON.stringify({success:false,data:[]}),JSON.stringify({success:true}),JSON.stringify({success:true,data:'x'.repeat(1000001)})])await expect(inspectHusherAccess('synthetic-api-credential',async()=>new Response(text))).rejects.toThrow();});
 it('rejects conflicting or escaped duplicate provider fields before normalization',async()=>{
  for(const text of ['{"success":false,"success":true,"data":[]}','{"success":true,"data":{"feeAmount":"1","feeAmount":"0"}}','{"success":true,"data":{"feeAmount":"1","fee\\u0041mount":"0"}}']){
   const fetcher=vi.fn(async()=>new Response(text));
   await expect(inspectHusherAccess('synthetic-api-credential',fetcher)).rejects.toThrow('No order');
   expect(fetcher).toHaveBeenCalledTimes(1);
  }
 });
});
