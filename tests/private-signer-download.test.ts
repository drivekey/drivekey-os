import {describe,it,expect,beforeEach,vi} from 'vitest';
const {verify}=vi.hoisted(()=>({verify:vi.fn()}));vi.mock('../core/private-signer-artifact',()=>({verifiedLocalArtifact:verify}));
import {HEAD} from '../app/api/private-signer/route';
describe('legacy private artifact route wiring (verification double)',()=>{beforeEach(()=>{verify.mockReset();verify.mockResolvedValue({close:async()=>{}});});const request=(v:string,host='127.0.0.1:3190',range?:string)=>new Request('http://127.0.0.1:3190/api/private-signer?version='+v,{headers:{host,...(range?{range}:{})}});
 it.each(['rc9','rc10','rc11','rc12'])('requires byte verifier for %s metadata without authentication claim',async v=>{const r=await HEAD(request(v));expect(r.status).toBe(200);expect(verify).toHaveBeenCalledOnce();expect(verify.mock.calls[0][1]).toBe(572915712);expect(r.headers.get('X-DriveKey-Verification')).toBe('local-byte-correspondence-only');});
 it('fails closed when bytes unavailable or changed',async()=>{verify.mockRejectedValue(Error('digest mismatch'));const r=await HEAD(request('rc10'));expect(r.status).toBe(503);expect(r.headers.has('X-DriveKey-SHA256')).toBe(false);});
 it('rejects unsupported/public requests without filesystem access',async()=>{expect((await HEAD(request('../../secret'))).status).toBe(400);expect((await HEAD(request('rc10','example.com'))).status).toBe(403);expect(verify).not.toHaveBeenCalled();});
 it('bounds ranges before hash IO',async()=>{expect((await HEAD(request('rc10','localhost:3190','bytes=0-999999999'))).status).toBe(416);expect(verify).not.toHaveBeenCalled();const r=await HEAD(request('rc10','localhost:3190','bytes=0-511'));expect(r.status).toBe(206);expect(r.headers.get('Content-Length')).toBe('512');});
});
