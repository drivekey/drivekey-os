"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { transactionSummary } = require("../transaction-summary.cjs");
const request = { version: 12, action: "swap", provider: "lifi-1inch", chain: "ethereum", from: "source", recipient: "recipient", tokenIn: "ETH", tokenOut: "USDC", amount: "1000000000000000000", quotedOutput: "3100000000", minimumOutput: "3000000000", fingerprint: "public-id", inputNotes: ["private-note-must-not-leave-projection"] };

test("history exposes only settled output and public request metadata", () => {
  const pending = transactionSummary({ request, state: "pending", settlement: { state: "pending", output: "999" } });
  assert.equal(pending.outputAmount, undefined);
  assert.equal(pending.provider, "lifi-1inch");
  assert.equal(pending.source, "source");
  assert.equal(pending.minimumOutput, "3000000000");
  assert.equal(JSON.stringify(pending).includes("private-note"), false);
  const confirmed = transactionSummary({ request, state: "confirmed", settlement: { state: "confirmed", output: "3050000000", actualFee: "1200000000000" } });
  assert.equal(confirmed.outputAmount, "3050000000");
  assert.equal(confirmed.outputState, "settled");
  assert.equal(confirmed.actualFee, "1200000000000");
});

test("source confirmation cannot publish a bridge destination credit", () => {
  const bridge = { ...request, action: "bridge", destinationChain: "solana" };
  const source = transactionSummary({ request: bridge, state: "confirmed", settlement: { state: "confirmed", output: "3050000000" } });
  assert.equal(source.state, "destination-pending");
  assert.equal(source.outputAmount, undefined);
  const delivered = transactionSummary({ request: bridge, state: "confirmed", destinationSettlement: { state: "confirmed", completeRoute: true, output: "3040000000" } });
  assert.equal(delivered.outputAmount, "3040000000");
  assert.equal(delivered.direction, "bridge");
});

test("legacy records and private outputs keep explicit unavailable amounts", () => {
  const legacy = transactionSummary({ request: { version: 8, chain: "ethereum", asset: "ETH", amount: "5" }, state: "prepared" });
  assert.equal(legacy.provider, "Direct payment");
  assert.equal(legacy.outputAmount, undefined);
  const privateSwap = transactionSummary({ request: { ...request, version: 21, chain: "solana", asset: "SOL" }, state: "confirmed", settlement: { state: "confirmed", actualOutputBaseUnits: "3010000" } });
  assert.equal(privateSwap.outputAmount, "3010000");
  const malformed = transactionSummary({ request: { ...request, amount: "1e10" }, state: "prepared" });
  assert.equal(malformed.amount, undefined);
});


test("allowance records expose a limit without an output asset", () => {
  const approval = transactionSummary({ request: { ...request, action: "approve", tokenIn: "USDC", tokenOut: "ETH" }, state: "confirmed", settlement: { state: "confirmed", output: "999" } });
  assert.equal(approval.outputAsset, undefined);
  assert.equal(approval.outputAmount, undefined);
  assert.equal(approval.outputState, undefined);
  assert.equal(approval.direction, "approval");
});
