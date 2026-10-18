import test from 'node:test';
import assert from 'node:assert/strict';
import {safeInput,compareLock} from './bootstrap-production-payload.mjs';
test('rejects traversal and hidden credential components',()=>{
  for(const p of ['../core/a.ts','/core/a.ts','core\\a.ts','core/.env','core/credentials/a.json']) assert.throws(()=>safeInput(p));
});
test('allows package-manager virtual paths without allowing arbitrary dotfiles',()=>{
  assert.equal(safeInput('node_modules/.pnpm/zod@3/node_modules/zod/index.js'),'node_modules/.pnpm/zod@3/node_modules/zod/index.js');
  assert.throws(()=>safeInput('core/.pnpm/a.ts'));
});
test('rejects synthetic harnesses and fixtures',()=>{
  for(const p of ['scripts/security-candidate-smoke.ts','core/tests/a.ts','scripts/create-fixture.ts','scripts/savings-inclusion-research/library.ts']) assert.throws(()=>safeInput(p));
});
test('rejects changed inputs, toolchains, missing or additional artifacts',()=>{
  const lock={toolchain:{version:'a'},sources:{'core/a.ts':'abc'},artifacts:{'a.cjs':'def'}};
  compareLock(lock,structuredClone(lock));
  for(const change of [x=>x.sources['core/a.ts']='changed',x=>x.toolchain.version='b',x=>delete x.artifacts['a.cjs'],x=>x.artifacts['extra']='x']) {
    const other=structuredClone(lock);change(other);assert.throws(()=>compareLock(lock,other));
  }
});
