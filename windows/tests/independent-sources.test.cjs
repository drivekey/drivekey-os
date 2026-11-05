'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {independent} = require('../tools/independent-sources.cjs');
const {independent: bridgeIndependent} = require('../tools/bridge-acceptance-policy.cjs');

test('independent observations require different normalized HTTPS hosts', () => {
  assert.equal(independent(['https://one.example/rpc', 'https://two.example/rpc']), true);
  assert.equal(bridgeIndependent, independent);
  for (const values of [
    ['https://same.example/a', 'https://same.example/b'],
    ['https://SAME.example/a', 'https://same.example:443/b?q=2'],
    ['https://same.example./a', 'https://same.example/b'],
    ['https://user:password@one.example', 'https://two.example'],
    ['http://one.example', 'https://two.example'],
    ['not-a-url', 'https://two.example'],
    [null, 'https://two.example'],
    ['https://one.example'],
    Array.from({length: 9}, (_, i) => 'https://host' + i + '.example'),
  ]) assert.equal(independent(values), false, JSON.stringify(values));
});
