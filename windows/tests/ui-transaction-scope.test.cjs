'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{transactionDetail}=require('../preparation-import.cjs');
const wallet={deviceId:'a8e25d4f-36d8-46cb-b129-728b8f354790',evmAddress:'0xAbCd111111111111111111111111111111111111',solanaAddress:'CafkSTDVwmkbjvtRqp71KUXVp13FmzDBbr7iNoVGoWSS'};
function record(chain,from){return {state:'prepared',request:{version:8,deviceId:wallet.deviceId,chain,from,recipient:'recipient',asset:chain==='ethereum'||chain==='sepolia'?'ETH':'SOL',amount:'1',fingerprint:'0x'+'1'.repeat(64),createdAt:'2026-11-03T00:00:00Z',expiresAt:'2026-11-03T00:10:00Z'}};}
test('transaction details bind Ethereum and Sepolia to the EVM identity',()=>{
  for(const chain of ['ethereum','sepolia']){const result=transactionDetail(record(chain,wallet.evmAddress.toLowerCase()),wallet,{});assert.equal(result.network,chain);assert.throws(()=>transactionDetail(record(chain,wallet.solanaAddress),wallet,{}));}
});
test('transaction details bind Solana and Devnet to the case-sensitive Solana identity',()=>{
  for(const chain of ['solana','devnet']){assert.equal(transactionDetail(record(chain,wallet.solanaAddress),wallet,{}).network,chain);assert.throws(()=>transactionDetail(record(chain,wallet.evmAddress),wallet,{}));assert.throws(()=>transactionDetail(record(chain,wallet.solanaAddress.toLowerCase()),wallet,{}));}
});
test('unknown networks and wrong wallet IDs fail closed',()=>{
  assert.throws(()=>transactionDetail(record('unknown',wallet.solanaAddress),wallet,{}));const wrong=record('sepolia',wallet.evmAddress);wrong.request.deviceId='another-wallet';assert.throws(()=>transactionDetail(wrong,wallet,{}));
});
