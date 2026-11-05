'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{reconcileRecord}=require('../transaction-store.cjs');
const {createFinalReceipt,receiptAvailable,transactionDetail}=require('../preparation-import.cjs');
const wallet={deviceId:'a8e25d4f-36d8-46cb-b129-728b8f354790',evmAddress:'0x1111111111111111111111111111111111111111'};
function base(action='payment',version=8){return {version:1,request:{version,deviceId:wallet.deviceId,from:wallet.evmAddress,chain:'ethereum',action,fingerprint:'0x'+'1'.repeat(64),amount:'1',asset:'ETH',recipient:'0x2222222222222222222222222222222222222222'},response:{rawSignedTransaction:'unchanged-signed-bytes',transactionHash:'unchanged-hash'},state:'pending'};}
test('receipt exports real reconcileRecord settlement, including nested evidence, unchanged',()=>{
  const evidence={state:'confirmed',receipt:{status:'0x1',transactionHash:'unchanged-hash',logs:[{data:'exact-log-evidence'}]},actualFee:'42',finalityVerified:true},record=reconcileRecord(base(),evidence),before=JSON.stringify(record),receipt=createFinalReceipt(record);
  assert.deepEqual(receipt.settlement,evidence);assert.equal(receipt.response.rawSignedTransaction,'unchanged-signed-bytes');assert.equal(receipt.walletId,wallet.deviceId);assert.equal(receiptAvailable(record),true);assert.equal(transactionDetail(record,wallet,{}).receiptAvailable,true);assert.equal(JSON.stringify(record),before);
  receipt.settlement.receipt.logs[0].data='export-copy-only';assert.equal(record.settlement.receipt.logs[0].data,'exact-log-evidence');
});
test('legacy finalized raw receipt remains supported and missing evidence is rejected',()=>{
  const record={...base(),state:'confirmed',receipt:{status:'0x1',blockHash:'legacy-block'}};assert.deepEqual(createFinalReceipt(record).settlement,record.receipt);
  for(const invalid of [{...base(),state:'confirmed'},{...base(),state:'confirmed',settlement:{}},{...base(),state:'confirmed',settlement:{state:'pending'}},base()]){assert.equal(receiptAvailable(invalid),false);assert.throws(()=>createFinalReceipt(invalid));}
});
test('source-only bridge confirmation never yields a final route receipt',()=>{
  const record=reconcileRecord(base('bridge',22),{state:'confirmed',completeRoute:false,receipt:{status:'0x1'},sourceState:'confirmed'});assert.equal(record.state,'confirmed');assert.equal(receiptAvailable(record),false);assert.equal(transactionDetail(record,wallet,{}).receiptAvailable,false);assert.throws(()=>createFinalReceipt(record),/Complete bridge delivery/);
});
test('fully confirmed destination wins and source settlement evidence is retained',()=>{
  let record=reconcileRecord(base('bridge',22),{state:'confirmed',completeRoute:false,sourceState:'confirmed',receipt:{source:'source-evidence'}});
  const destination={state:'confirmed',completeRoute:true,sourceState:'confirmed',receipt:{destination:'destination-evidence'},minimumCredit:'123',observedCredit:'124'};
  record=reconcileRecord(record,destination,{destination:true});const before=JSON.stringify(record),receipt=createFinalReceipt(record);
  assert.deepEqual(receipt.settlement,destination);assert.deepEqual(receipt.sourceSettlement,record.settlement);assert.equal(receiptAvailable(record),true);assert.equal(transactionDetail(record,wallet,{}).receiptAvailable,true);assert.equal(JSON.stringify(record),before);
});
test('bridge redemption requires completeRoute, while allowance approvals and revocations do not',()=>{
  const missing=reconcileRecord(base('bridge-redeem',24),{state:'confirmed',receipt:{status:'0x1'}});assert.equal(receiptAvailable(missing),false);
  const done=reconcileRecord(base('bridge-redeem',24),{state:'confirmed',completeRoute:true,receipt:{status:'0x1'}});assert.equal(receiptAvailable(done),true);
  for(const action of ['approve','revoke']){const record=reconcileRecord(base(action,22),{state:'confirmed',receipt:{status:'0x1'},allowance:action==='approve'?'1':'0'});assert.equal(receiptAvailable(record),true);assert.equal(createFinalReceipt(record).settlement.allowance,action==='approve'?'1':'0');}
});
test('legacy confirmed source records on other bridge versions remain destination pending',()=>{
  for(const version of [23,25,26]){const record={...base('bridge',version),state:'confirmed',receipt:{status:'0x1'}},detail=transactionDetail(record,wallet,{});assert.equal(detail.state,'destination-pending');assert.equal(detail.sourceConfirmed,true);assert.equal(detail.destinationConfirmed,undefined);assert.equal(detail.receiptAvailable,false);}
});
test('legacy redemption confirmation without complete delivery is not full confirmation',()=>{
  const record=reconcileRecord(base('bridge-redeem',24),{state:'confirmed',receipt:{status:'0x1'}}),detail=transactionDetail(record,wallet,{});assert.equal(detail.state,'destination-pending');assert.equal(detail.sourceConfirmed,undefined);assert.equal(detail.destinationConfirmed,undefined);assert.equal(detail.receiptAvailable,false);
});
test('complete routes and standalone allowance display remain confirmed',()=>{
  for(const [action,version]of [['bridge',23],['bridge',25],['bridge',26],['bridge-redeem',24]]){const record=reconcileRecord(base(action,version),{state:'confirmed',completeRoute:true,receipt:{status:'0x1'}}),detail=transactionDetail(record,wallet,{});assert.equal(detail.state,'confirmed');assert.equal(detail.destinationConfirmed,true);assert.equal(detail.receiptAvailable,true);}
  for(const action of ['approve','revoke'])assert.equal(transactionDetail(reconcileRecord(base(action,22),{state:'confirmed',receipt:{status:'0x1'}}),wallet,{}).state,'confirmed');
});
