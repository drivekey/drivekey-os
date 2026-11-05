'use strict';
const assert=require('node:assert/strict');
function classifyStoreTests(tap,policy){
 assert.equal(policy.version,1);
 const expected=new Map(policy.deferredPositiveCases.map(item=>[item.name,item]));
 assert.equal(expected.size,policy.deferredPositiveCases.length,'Duplicate deferred-case name');
 const matches=[...tap.matchAll(/^(not ok|ok) (\d+) - (.+)\r?$/gm)];
 const rows=matches.map((match,index)=>({passed:match[1]==='ok',name:match[3].trim(),block:tap.slice(match.index,matches[index+1]?.index??tap.length)}));
 const number=name=>Number(new RegExp('^# '+name+' (\\d+)\\r?$','m').exec(tap)?.[1]);
 const stats={tests:number('tests'),passes:number('pass'),failures:number('fail'),skipped:number('skipped'),cancelled:number('cancelled'),todo:number('todo')};
 assert.ok(Object.values(stats).every(Number.isSafeInteger),'Missing TAP summary');
 assert.equal(rows.length,stats.tests,'Unparsed or nested TAP results');
 assert.equal(new Set(rows.map(row=>row.name)).size,rows.length,'Duplicate test names');
 assert.equal(rows.filter(row=>!row.passed).length,stats.failures,'Failure count mismatch');
 const classifiedDeferred=[],unexpectedFailures=[];
 for(const row of rows.filter(row=>!row.passed)){
  const entry=expected.get(row.name);
  const location=/^  location: (.+)$/m.exec(row.block)?.[1]||'';
  const error=/^  error: ([\s\S]*?)(?=\r?\n  [A-Za-z][A-Za-z0-9_]*:|\r?\n  \.\.\.)/m.exec(row.block)?.[1]||'';
  if(entry&&location.includes(entry.file.split('/').at(-1)+':')&&policy.allowedDeferredDenials.some(denial=>error.includes(denial)))classifiedDeferred.push({name:row.name,file:entry.file,reason:entry.reason});
  else unexpectedFailures.push(row.name);
 }
 const passedNames=new Set(rows.filter(row=>row.passed).map(row=>row.name));
 const missingRequired=policy.requiredTests.filter(name=>!passedNames.has(name));
 const missingDeferred=policy.deferredPositiveCases.filter(item=>!rows.some(row=>row.name===item.name)).map(item=>item.name);
 const unexpectedlyEnabled=policy.deferredPositiveCases.filter(item=>passedNames.has(item.name)).map(item=>item.name);
 const paymentsOnlyPassed=stats.tests>=policy.minimumHistoricalTestCount&&stats.skipped===0&&stats.cancelled===0&&stats.todo===0&&unexpectedFailures.length===0&&missingRequired.length===0&&missingDeferred.length===0&&unexpectedlyEnabled.length===0&&classifiedDeferred.length===expected.size;
 return {paymentsOnlyPassed,fullHistoricalSuitePassed:stats.failures===0&&stats.skipped===0&&stats.cancelled===0&&stats.todo===0,stats,classifiedDeferred,unexpectedFailures,missingRequired,missingDeferred,unexpectedlyEnabled};
}
module.exports={classifyStoreTests};
