const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),deps=createRequire(path.join(process.env.DRIVEKEY_BUILD_MODULES||root,'package.json'));
const {updates,resolveWebRoute}=require('../web-links.cjs');
const {makeReceiveInfo}=require('../dist/receive.cjs');
const {Wallet}=deps('ethers'),{Keypair,Connection}=deps('@solana/web3.js');
const qrcodeDeps=createRequire(deps.resolve('qrcode')),{PNG}=qrcodeDeps('pngjs'),jsQR=deps('jsqr');
const wallet={version:3,deviceId:'12345678-1234-4234-8234-123456789abc',createdAt:new Date().toISOString(),evmAddress:Wallet.createRandom().address,solanaAddress:Keypair.generate().publicKey.toBase58()};
test('deposit QR independently decodes the exact Ethereum address and chain',async()=>{const info=await makeReceiveInfo(wallet,'ethereum'),png=PNG.sync.read(Buffer.from(info.qr.split(',')[1],'base64'));const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded.data,'ethereum:'+wallet.evmAddress+'@1');assert.equal(info.address,wallet.evmAddress);});
test('Solana QR independently decodes the loaded public identity',async()=>{const info=await makeReceiveInfo(wallet,'solana'),png=PNG.sync.read(Buffer.from(info.qr.split(',')[1],'base64'));const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded.data,'solana:'+wallet.solanaAddress);assert.equal(info.address,wallet.solanaAddress);});
test('invalid deposit networks and mismatched public identities fail closed',async()=>{await assert.rejects(makeReceiveInfo(wallet,'bitcoin'));await assert.rejects(makeReceiveInfo({...wallet,evmAddress:'secret'},'ethereum'));});

test('updated JSON-RPC dependency remains compatible with the pinned Solana client',async()=>{
 let calls=0;
 const connection=new Connection('http://127.0.0.1:8899',{fetch:async(_url,options)=>{calls++;const request=JSON.parse(options.body);assert.equal(request.method,'getGenesisHash');assert.equal(typeof request.id,'string');return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(await connection.getGenesisHash(),'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');assert.equal(calls,1);
});
test('website actions resolve to the existing exact routes and never accept arbitrary URLs',()=>{assert.equal(resolveWebRoute('swap','direct').url,'https://drivekey.info/app/swap?provider=direct');assert.equal(resolveWebRoute('swap','jupiter').url,'https://drivekey.info/app/swap?provider=jupiter');assert.equal(resolveWebRoute('hinkal-deposit').url,'https://drivekey.info/app/hinkal');assert.equal(resolveWebRoute('savings','strong').url,'https://drivekey.info/app/savings');for(const [route,option]of [['swap','https://evil.example'],['swap','__proto__'],['article','https://evil.example'],['https://evil.example',''],['savings','weak']])assert.throws(()=>resolveWebRoute(route,option));assert.equal(updates.length,3);assert.ok(updates.every(post=>/^https:\/\/x\.com\/DriveKeyyy\/status\/\d+$/.test(post.url)));});
