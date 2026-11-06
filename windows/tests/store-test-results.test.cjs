'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyStoreTests}=require('../tools/store-test-results.cjs');
const denial='This Windows release supports direct ETH, SOL and USDC payments.';
const policy={version:1,minimumHistoricalTestCount:2,requiredTests:['required payment'],deferredPositiveCases:[{name:'deferred swap',file:'tests/swap.test.cjs',reason:'Not enabled in Store'}],allowedDeferredDenials:[denial]};
function fixture({extra=false,deferredPass=false,wrongFile=false,skip=false}={}){
 const count=extra?3:2,failures=(deferredPass?0:1)+(extra?1:0);
 return 'TAP version 13\nok 1 - required payment\n'+(deferredPass?'ok':'not ok')+' 2 - deferred swap\n  ---\n  location: tests/'+(wrongFile?'payment':'swap')+'.test.cjs:1:1\n  error: '+denial+'\n  code: ERR_TEST_FAILURE\n  ...\n'+(extra?'not ok 3 - active payment failure\n  ---\n  error: '+denial+'\n  code: ERR_TEST_FAILURE\n  ...\n':'')+'1..'+count+'\n# tests '+count+'\n# pass '+(count-failures)+'\n# fail '+failures+'\n# cancelled 0\n# skipped '+(skip?1:0)+'\n# todo 0\n';
}
test('Store reporting discloses deferred failures without declaring full-suite success',()=>{
 const result=classifyStoreTests(fixture(),policy);
 assert.equal(result.paymentsOnlyPassed,true);assert.equal(result.fullHistoricalSuitePassed,false);
 assert.equal(result.stats.failures,1);assert.equal(result.classifiedDeferred.length,1);
  assert.equal(result.localChecksPassed,false);
});
test('Store reporting cannot mask an active payment failure or an unexpected failure location',()=>{
 assert.equal(classifyStoreTests(fixture({extra:true}),policy).paymentsOnlyPassed,false);
 assert.equal(classifyStoreTests(fixture({wrongFile:true}),policy).paymentsOnlyPassed,false);
});
test('Store reporting fails when deferred transactions unexpectedly become enabled',()=>{
 const result=classifyStoreTests(fixture({deferredPass:true}),policy);
 assert.equal(result.paymentsOnlyPassed,false);assert.deepEqual(result.unexpectedlyEnabled,['deferred swap']);
});
test('Store reporting rejects skips, missing required checks and incomplete summaries',()=>{
 assert.equal(classifyStoreTests(fixture({skip:true}),policy).paymentsOnlyPassed,false);
 assert.equal(classifyStoreTests(fixture(),{...policy,requiredTests:['missing payment']}).paymentsOnlyPassed,false);
 assert.throws(()=>classifyStoreTests(fixture().replace('# tests 2','# tests 99'),policy),/Unparsed/);
});
test('full local reporting requires every former deferred case to pass and never masks a failed workflow',()=>{
 const fullPolicy={...policy,deferredPositiveCases:[],allowedDeferredDenials:[],requiredTests:['required payment','deferred swap']};
 const passed=classifyStoreTests(fixture({deferredPass:true}),fullPolicy);
 assert.equal(passed.localChecksPassed,true);assert.equal(passed.fullHistoricalSuitePassed,true);assert.deepEqual(passed.classifiedDeferred,[]);
 const failed=classifyStoreTests(fixture(),fullPolicy);assert.equal(failed.localChecksPassed,false);assert.deepEqual(failed.unexpectedFailures,['deferred swap']);assert.deepEqual(failed.missingRequired,['deferred swap']);
 assert.equal(classifyStoreTests(fixture({deferredPass:true,skip:true}),fullPolicy).localChecksPassed,false);
});
