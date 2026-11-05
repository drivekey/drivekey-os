'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require(process.env.DRIVEKEY_REVIEW_TEST_MODULE||'../dist/lifi-mayan-evm.cjs');
const fixture=require('./fixtures/lifi-mayan-evm-source.json');
test('Historical Mayan bridge review exposes all validated costs without changing archived bytes',()=>{
  const request=structuredClone(fixture.request),before=JSON.stringify(request),review=core.lifiMayanEvmReview(request,Date.parse(request.createdAt),false);
  for(const key of ['quotedOutput','protocolFee','redeemFee','circleMaxFee','maximumMayanFee','minimumOutput'])assert.equal(review[key],request[key],key+' must be visible');
  assert.equal(review.maximumFeeBaseUnits,request.maximumFee);assert.equal(review.destinationNativeGasDropBaseUnits,request.gasDrop);assert.equal(review.fingerprint,request.fingerprint);assert.equal(JSON.stringify(request),before);
});
