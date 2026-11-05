const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {PGlite}=require('@electric-sql/pglite');const {Wallet}=require('ethers');const {Keypair}=require('@solana/web3.js');const bs58=require('bs58').default;
const {CheckoutService,deliverWebhook,verifyWebhook,webhookSignature}=require('../dist/checkout-service.cjs');
let db,service;const clock=()=>new Date('2026-11-01T12:00:00Z'),hash='0x'+'a'.repeat(64);let amount='100',time='2026-11-01T12:00:10Z',canonical=true,asset='ETH',recipientOverride;
before(async()=>{db=new PGlite();await db.exec(await fs.readFile(new URL('../merchant/schema.sql', 'file:///'+__filename.replaceAll('\\','/')),'utf8'));service=new CheckoutService(db,async i=>[{chain:i.chain,asset,recipient:recipientOverride||i.address,amount,transactionHash:hash,eventIndex:0,chainTime:time,canonical,proof:{blockHash:'fixture-only'}}],clock);await service.provision('sepolia',Array.from({length:20},()=>Wallet.createRandom().address));});
after(async()=>db.close());
const create=(key='test-idempotency-001')=>service.create({chain:'sepolia',asset:'ETH',amount:'100',expiresInSeconds:60},key);
test('PostgreSQL schema allocates unique addresses, retains idempotency and rejects mismatched repeats',async()=>{
 const first=await create(),again=await create();assert.equal(first.id,again.id);await assert.rejects(()=>service.create({chain:'sepolia',asset:'ETH',amount:'101',expiresInSeconds:60},'test-idempotency-001'));
 const invoices=await Promise.all(Array.from({length:8},(_,n)=>create('concurrent-request-'+String(n).padStart(3,'0'))));assert.equal(new Set(invoices.map(i=>i.address)).size,8);
});
test('underpayment, overpayment, duplicate notifications and exact settled amount use verified chain evidence',async()=>{
 const i=await create('payments-test-0001');amount='40';let r=await service.observe(i.public_token,hash);assert.equal(r.status,'underpaid');await service.observe(i.public_token,hash);assert.equal((await service.get(i.public_token)).paid,'40');
 // Same payment cannot change amount, recipient or asset.
 amount='100';await assert.rejects(()=>service.observe(i.public_token,hash),/evidence changed/);amount='40';recipientOverride=Wallet.createRandom().address;await assert.rejects(()=>service.observe(i.public_token,hash),/differs/);recipientOverride=undefined;asset='USDC';await assert.rejects(()=>service.observe(i.public_token,hash),/differs/);asset='ETH';
 const next=await create('overpayment-00001');service.verify=async inv=>[{chain:inv.chain,asset:'ETH',recipient:inv.address,amount:'110',transactionHash:'0x'+'b'.repeat(64),eventIndex:0,chainTime:time,canonical:true,proof:{fixture:true}}];r=await service.observe(next.public_token,'0x'+'b'.repeat(64));assert.equal(r.status,'overpaid');
});
test('late payments and reorgs never produce a paid state; one payment cannot fund two invoices',async()=>{
 const i=await create('latepayment-00001'),h='0x'+'c'.repeat(64);service.verify=async inv=>[{chain:inv.chain,asset:'ETH',recipient:inv.address,amount:'100',transactionHash:h,eventIndex:0,chainTime:'2026-11-01T12:02:00Z',canonical:true,proof:{fixture:true}}];assert.equal((await service.observe(i.public_token,h)).status,'late-payment');
 const other=await create('duplicatepay-00001');await assert.rejects(()=>service.observe(other.public_token,h),/claimed/);
 await db.query('UPDATE payment_claims SET canonical=false WHERE invoice_id=$1',[i.id]);assert.equal((await service.get(i.public_token)).status,'review-reorg');
 const rows=await db.query('SELECT * FROM webhook_outbox WHERE invoice_id=$1',[i.id]);assert.equal(rows.rows.length,2);
});
test('concurrent Solana receipt claims reject the losing invoice and a valid replay remains idempotent',async()=>{
 const isolated=new PGlite();
 try{
  await isolated.exec(await fs.readFile(new URL('../merchant/schema.sql','file:///'+__filename.replaceAll('\\','/')),'utf8'));
  const {promise:ready,resolve:release}=Promise.withResolvers();let arrivals=0;
  const synchronized={query:async(sql,params)=>{
   if(sql.startsWith('INSERT INTO payment_claims')&&arrivals<2){if(++arrivals===2)release();await ready;}
   return isolated.query(sql,params);
  }};
  const checkout=new CheckoutService(synchronized,async(invoice,transactionHash)=>[{chain:'solana',asset:invoice.asset,
   recipient:invoice.address,amount:'100',transactionHash,eventIndex:0,chainTime:'2026-11-01T12:00:10Z',canonical:true,proof:{fixture:true}}],clock);
  await checkout.provision('solana',Array.from({length:4},()=>Keypair.generate().publicKey.toBase58()));
  const [sol,competing,usdc]=await Promise.all(['SOL','SOL','USDC'].map((asset,index)=>checkout.create({chain:'solana',asset,amount:'100',expiresInSeconds:60},`solana-race-fixture-${index}`)));
  const signatures=[bs58.encode(Buffer.alloc(64,0x16)),bs58.encode(Buffer.alloc(64,0x32))];
  const results=await Promise.allSettled([sol,competing].map(invoice=>checkout.observe(invoice.public_token,signatures[0])));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const loser=results.findIndex(result=>result.status==='rejected');
  assert.match(results[loser].reason.message,/claimed or evidence changed/);
  assert.equal((await checkout.get([sol,competing][loser].public_token)).status,'open');
  const winner=[sol,competing][1-loser];
  for(const [invoice,signature]of [[winner,signatures[0]],[usdc,signatures[1]]]){
   for(let attempt=0;attempt<3;attempt++){
    const status=await checkout.observe(invoice.public_token,signature);
    assert.equal(status.status,'paid');assert.equal(String(status.paid),'100');
   }
   const {rows}=await isolated.query('SELECT canonical FROM payment_claims WHERE invoice_id=$1',[invoice.id]);
   assert.deepEqual(rows,[{canonical:true}]);
   const outbox=await isolated.query('SELECT revision FROM webhook_outbox WHERE invoice_id=$1',[invoice.id]);
   assert.deepEqual(outbox.rows,[{revision:1}]);
  }
 }finally{await isolated.close();}
});
test('webhook outbox retries failures with stable event/body and rejects replayed or altered authentication',async()=>{
 const secret='webhook-test-only-32-character-secret',now=Date.now(),sent=[];
 const send=async(url,init)=>{sent.push(init);return new Response('',{status:sent.length===1?503:200});};
 await deliverWebhook(db,'https://merchant.example/webhook',secret,send,now);const first=sent[0];assert.equal(verifyWebhook(secret,first.headers['x-drivekey-timestamp'],first.body,first.headers['x-drivekey-signature'],now),true);assert.equal(verifyWebhook(secret,first.headers['x-drivekey-timestamp'],first.body+'x',first.headers['x-drivekey-signature'],now),false);assert.equal(verifyWebhook(secret,first.headers['x-drivekey-timestamp'],first.body,first.headers['x-drivekey-signature'],now+600000),false);
 await db.query("UPDATE webhook_outbox SET available_at=now()-interval '1 second' WHERE id=$1",[first.headers['x-drivekey-event']]);await db.query('UPDATE webhook_outbox SET available_at=now()+interval \'1 hour\' WHERE id<>$1',[first.headers['x-drivekey-event']]);await deliverWebhook(db,'https://merchant.example/webhook',secret,send,now+1000);assert.equal(sent[1].body,first.body);assert.equal(sent[1].headers['x-drivekey-event'],first.headers['x-drivekey-event']);assert.notEqual(sent[1].headers['x-drivekey-signature'],first.headers['x-drivekey-signature']);
 const delivered=(await db.query('SELECT delivered_at FROM webhook_outbox WHERE id=$1',[first.headers['x-drivekey-event']])).rows[0];assert.ok(delivered.delivered_at);
});
