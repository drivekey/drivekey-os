"use strict";

function amount(value) {
  return typeof value === "string" && /^\d{1,78}$/.test(value) ? value : undefined;
}

function text(value, limit = 128) {
  return typeof value === "string" && value.length <= limit ? value : undefined;
}

function transactionSummary(record) {
  const request = record.request;
  const bridge = ["bridge", "bridge-redeem"].includes(request.action);
  const destination = record.destinationSettlement || record.settlement;
  const completeRoute = destination?.state === "confirmed" && destination.completeRoute === true;
  const sourceOnly = bridge && record.state === "confirmed" && !completeRoute;
  const state = sourceOnly ? "destination-pending" : record.state;
  const inputAsset = text(request.asset || request.tokenIn, 16);
  const allowance = /approve|revoke/.test(request.action || "");
  const outputAsset = allowance ? undefined : text(request.tokenOut, 16);
  const settled = state === "confirmed" && destination?.state === "confirmed";
  const outputAmount = settled && outputAsset ? amount(destination.output ?? destination.actualOutputBaseUnits) : undefined;
  const fee = settled ? amount(destination.actualFeeBaseUnits ?? destination.actualFee) : undefined;

  return {
    id: request.fingerprint,
    version: request.version,
    action: text(request.action, 40),
    provider: text(request.provider, 80) || (request.version === 8 ? "Direct payment" : undefined),
    network: request.chain,
    destinationNetwork: request.destinationChain,
    asset: outputAsset ? `${inputAsset} → ${outputAsset}` : inputAsset,
    inputAsset,
    outputAsset,
    amount: amount(request.amount),
    outputAmount,
    minimumOutput: amount(request.minimumOutput),
    outputState: outputAsset ? (outputAmount === undefined ? "awaiting-settlement" : "settled") : undefined,
    source: text(request.from),
    recipient: text(request.recipient),
    direction: allowance ? "approval" : request.action === "hinkal-withdraw" ? "withdraw" : bridge ? "bridge" : outputAsset && /swap/.test(request.action || "") ? "swap" : "sent",
    actualFee: fee,
    feeAsset: ["solana", "devnet"].includes(request.chain) ? "SOL" : "ETH",
    state,
    transactionHash: record.response?.transactionHash,
    reason: record.reason,
    createdAt: request.createdAt,
    updatedAt: record.updatedAt
  };
}

module.exports = { transactionSummary };
