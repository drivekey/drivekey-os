// Public-chain data only. No private-key or vault imports.
import { Connection, PublicKey, NonceAccount, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackMint, unpackAccount, getAssociatedTokenAddressSync, ACCOUNT_SIZE } from "@solana/spl-token";
import { Transaction, getAddress, keccak256, parseUnits, toQuantity } from "ethers";
import { CHAIN_ID, type Rpc } from "./protocol";
import { ERC20, MULTI_TTL, SOLANA_GENESIS, canonicalSolTransaction, encodeSolUnsigned, multiFingerprint, multiPublicSchema, validateMultiRequest, type MultiPublic, type MultiRequest, type ErcRequest, type SolRequest } from "./multi-protocol";
import { assetIdentity, assetLabel } from "./asset-identity";
import {checkKnownRobinhoodProxy} from './robinhood-proxy-identity';

function number(input: unknown): bigint {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(input)) throw new Error("Invalid RPC quantity.");
  return BigInt(input);
}
export async function inspectErc20(rpc: Rpc, contract: string, owner: string) {
  assetIdentity("robinhood", contract); getAddress(owner);
  if (number(await rpc("eth_chainId")) !== BigInt(CHAIN_ID)) throw new Error("Wrong network.");
  const token = getAddress(contract), code = await rpc("eth_getCode", [token, "latest"]);
  if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) || code.length > 100_000) throw new Error("Token contract code is missing or unsupported.");
  const read = async (method: string, args: unknown[] = []) => {
    const value = await rpc("eth_call", [{ to: token, data: ERC20.encodeFunctionData(method, args) }, "latest"]);
    if (typeof value !== "string" || value.length > 4096) throw new Error("Token response exceeds limits.");
    return ERC20.decodeFunctionResult(method, value)[0];
  };
  const [decimalsValue, balanceValue, symbol, name] = await Promise.all([read("decimals"), read("balanceOf", [owner]), read("symbol").catch(() => null), read("name").catch(() => null)]);
  const decimals = Number(decimalsValue);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || typeof balanceValue !== "bigint") throw new Error("Unsupported token decimals or balance.");
  return { id: assetIdentity("robinhood", token), network: "robinhood" as const, address: token, decimals, balance: balanceValue.toString(), symbol: assetLabel(symbol, "TOKEN"), name: assetLabel(name, "Unknown token"), codeHash: keccak256(code), warning: "Import is not a safety assessment. Taxed, rebasing, paused and upgradeable behavior may prevent exact delivery.", updatedAt: new Date().toISOString() };
}
function context(w: MultiPublic, now: number) { return { version: 3 as const, requestId: crypto.randomUUID(), deviceId: w.deviceId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + MULTI_TTL).toISOString(), fingerprint: "0x" + "00".repeat(32) }; }
export async function prepareErc20(inputWallet: unknown, contract: string, recipient: string, amount: string, rpc: Rpc, now = Date.now()): Promise<ErcRequest> {
  const w = multiPublicSchema.parse(inputWallet), token = await inspectErc20(rpc, contract, w.evmAddress), to = getAddress(recipient);
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(amount) || amount.length > 78) throw new Error("Invalid token amount.");
  const units = parseUnits(amount, token.decimals), data = ERC20.encodeFunctionData("transfer", [to, units]);
  const call = { from: w.evmAddress, to: token.address, data, value: "0x0" };
  const [nonce, gas, block, tip, balance, simulation] = await Promise.all([rpc("eth_getTransactionCount", [w.evmAddress, "pending"]), rpc("eth_estimateGas", [call]), rpc("eth_getBlockByNumber", ["latest", false]), rpc("eth_maxPriorityFeePerGas"), rpc("eth_getBalance", [w.evmAddress, "pending"]), rpc("eth_call", [call, "pending"])]);
  if (simulation !== ERC20.encodeFunctionResult("transfer", [true])) throw new Error("Token simulation did not return canonical true. Unsupported transfer behavior.");
  if (units <= 0n || units > BigInt(token.balance)) throw new Error("Insufficient token balance.");
  const fee = number((block as { baseFeePerGas: unknown }).baseFeePerGas) * 2n + number(tip), gasLimit = number(gas) * 12n / 10n;
  if (number(balance) < fee * gasLimit) throw new Error("Insufficient ETH for maximum fees.");
  if (number(nonce) > 4_294_967_295n) throw new Error("Nonce out of range.");
  const tx = Transaction.from({ type: 2, chainId: CHAIN_ID, to: token.address, value: 0n, data, nonce: Number(number(nonce)), gasLimit, maxFeePerGas: fee, maxPriorityFeePerGas: number(tip) });
  const identity=await checkKnownRobinhoodProxy(rpc,token.address);
  const base = { ...context(w, now), network: "robinhood" as const, chainId: CHAIN_ID, standard: "erc20" as const, from: w.evmAddress, recipient: to, token: token.address, amount: units.toString(), decimals: token.decimals, codeHash: token.codeHash, unsignedTransaction: tx.unsignedSerialized };
  const r:ErcRequest=identity?{...base,version:6,implementation:identity.implementation,implementationCodeHash:identity.implementationCodeHash}:base;
  r.fingerprint = multiFingerprint(r); return validateMultiRequest(r, now) as ErcRequest;
}
export async function preflightErc20(r: ErcRequest, rpc: Rpc) {
  validateMultiRequest(r);
  const tx = Transaction.from(r.unsignedTransaction), token = await inspectErc20(rpc, r.token, r.from);
  if (token.decimals !== r.decimals || token.codeHash !== r.codeHash) throw new Error("Token metadata or code changed. Obtain a fresh offline approval.");
  if (BigInt(token.balance) < BigInt(r.amount)) throw new Error("Insufficient tokens.");
  const call = { from: r.from, to: r.token, value: "0x0", data: tx.data, gas: toQuantity(tx.gasLimit), maxFeePerGas: toQuantity(tx.maxFeePerGas!), maxPriorityFeePerGas: toQuantity(tx.maxPriorityFeePerGas!) };
  const [nonce, balance, gas, block, simulation] = await Promise.all([rpc("eth_getTransactionCount", [r.from, "pending"]), rpc("eth_getBalance", [r.from, "pending"]), rpc("eth_estimateGas", [call]), rpc("eth_getBlockByNumber", ["latest", false]), rpc("eth_call", [call, "pending"])]);
  if (number(nonce) !== BigInt(tx.nonce)) throw new Error("Nonce changed. Reconcile previous activity.");
  if (number(balance) < tx.gasLimit * tx.maxFeePerGas! || number(gas) > tx.gasLimit || number((block as { baseFeePerGas: unknown }).baseFeePerGas) + tx.maxPriorityFeePerGas! > tx.maxFeePerGas!) throw new Error("Balance or fee conditions changed.");
  if (simulation !== ERC20.encodeFunctionResult("transfer", [true])) throw new Error("Transfer simulation failed.");
  const identity=await checkKnownRobinhoodProxy(rpc,r.token);
  if(identity&&(r.version!==6||r.implementation.toLowerCase()!==identity.implementation.toLowerCase()||r.implementationCodeHash!==identity.implementationCodeHash))throw Error('Proxy identity requires fresh v6 offline approval and a new verified ISO.');
}

export async function checkSolanaCluster(connection: Connection) { if (await connection.getGenesisHash() !== SOLANA_GENESIS) throw new Error("Wrong Solana cluster."); }
export async function inspectSpl(connection: Connection, mintAddress: string, owner: string) {
  await checkSolanaCluster(connection);
  assetIdentity("solana", mintAddress);
  const mint = new PublicKey(mintAddress), info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Mint not found on Solana mainnet.");
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return { address: mintAddress, supported: false as const, reason: "Token-2022 is not yet enabled: no extensions have passed release acceptance." };
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) throw new Error("Not a supported SPL mint.");
  const data = unpackMint(mint, info, TOKEN_PROGRAM_ID);
  if (!data.isInitialized || data.decimals > 18 || data.tlvData.length) throw new Error("Unsupported mint layout or decimals.");
  const ata = getAssociatedTokenAddressSync(mint, new PublicKey(owner)), accountInfo = await connection.getAccountInfo(ata, "confirmed");
  let balance = 0n, frozen = false;
  if (accountInfo) { const a = unpackAccount(ata, accountInfo); if (!a.mint.equals(mint) || !a.owner.equals(new PublicKey(owner)) || a.delegate || a.closeAuthority || a.tlvData.length) throw new Error("Unsupported token-account authorities."); balance = a.amount; frozen = a.isFrozen; }
  return { address: mintAddress, supported: !frozen, reason: frozen ? "Token account is frozen." : "Standard SPL transfer only. Mint/freeze authorities may affect holdings.", decimals: data.decimals, balance: balance.toString(), symbol: "SPL", name: "SPL token", freezeAuthority: data.freezeAuthority?.toBase58() ?? null };
}
async function inspectNonce(connection: Connection, address: string, authority: string) {
  const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
  if (!info || !info.owner.equals(SystemProgram.programId) || info.data.length !== 80 || info.data.readUInt32LE(4) !== 1) throw new Error("An initialized durable nonce account is required.");
  const nonce = NonceAccount.fromAccountData(info.data);
  if (nonce.authorizedPubkey.toBase58() !== authority) throw new Error("Nonce authority must be this offline wallet.");
  return nonce;
}
export async function prepareSol(inputWallet: unknown, mintAddress: string, recipient: string, amount: string, nonceAccount: string, connection: Connection, now = Date.now()): Promise<SolRequest> {
  const w = multiPublicSchema.parse(inputWallet); await checkSolanaCluster(connection);
  const from = new PublicKey(w.solanaAddress), to = new PublicKey(recipient);
  if (!PublicKey.isOnCurve(to.toBytes())) throw new Error("Use a normal wallet recipient; off-curve recipients are unsupported.");
  const nonce = await inspectNonce(connection, nonceAccount, w.solanaAddress);
  let decimals = 9, createRecipientAccount = false, accountRent = "0";
  if (mintAddress !== "native") {
    const asset = await inspectSpl(connection, mintAddress, w.solanaAddress);
    if (!asset.supported || !("decimals" in asset)) throw new Error(asset.reason);
    decimals = asset.decimals;
    if (parseUnits(amount, decimals) > BigInt(asset.balance)) throw new Error("Insufficient SPL tokens.");
    const target = getAssociatedTokenAddressSync(new PublicKey(mintAddress), to), info = await connection.getAccountInfo(target, "confirmed");
    if (info) { const a = unpackAccount(target, info); if (!a.mint.equals(new PublicKey(mintAddress)) || !a.owner.equals(to) || a.isFrozen || a.delegate || a.closeAuthority || a.tlvData.length) throw new Error("Recipient token account is unsupported."); }
    else { createRecipientAccount = true; accountRent = String(await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed")); }
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(amount) || amount.length > 78) throw new Error("Invalid amount.");
  const r: SolRequest = { ...context(w, now), network: "solana", genesisHash: SOLANA_GENESIS, standard: mintAddress === "native" ? "native" : "spl", from: w.solanaAddress, recipient: to.toBase58(), token: mintAddress, amount: parseUnits(amount, decimals).toString(), decimals, nonceAccount, nonceValue: nonce.nonce, maximumFee: "5000", accountRent, createRecipientAccount, unsignedTransaction: "" };
  const tx = canonicalSolTransaction(r), fee = (await connection.getFeeForMessage(tx.compileMessage(), "confirmed")).value;
  if (fee === null || !Number.isSafeInteger(fee) || fee <= 0) throw new Error("Durable nonce fee estimate unavailable.");
  r.maximumFee = String(fee);
  if (BigInt(await connection.getBalance(from, "confirmed")) < BigInt(fee) + BigInt(accountRent) + (r.standard === "native" ? BigInt(r.amount) : 0n)) throw new Error("Insufficient SOL for transfer, fees and rent.");
  r.unsignedTransaction = encodeSolUnsigned(tx); r.fingerprint = multiFingerprint(r);
  return validateMultiRequest(r, now) as SolRequest;
}
export async function preflightSol(r: SolRequest, connection: Connection) {
  validateMultiRequest(r); await checkSolanaCluster(connection);
  const nonce = await inspectNonce(connection, r.nonceAccount, r.from);
  if (nonce.nonce !== r.nonceValue) throw new Error("Durable nonce changed or consumed. Reconcile the original signature.");
  // Re-prepare public state and compare semantic costs; never replace approved bytes.
  const whole = BigInt(r.amount) / 10n ** BigInt(r.decimals), fraction = (BigInt(r.amount) % 10n ** BigInt(r.decimals)).toString().padStart(r.decimals, "0");
  const amount = r.decimals ? `${whole}.${fraction}` : String(whole);
  const w: MultiPublic = { version: 3, deviceId: r.deviceId, createdAt: r.createdAt, evmAddress: "0x0000000000000000000000000000000000000001", solanaAddress: r.from };
  const fresh = await prepareSol(w, r.token, r.recipient, amount, r.nonceAccount, connection);
  if (fresh.decimals !== r.decimals || fresh.unsignedTransaction !== r.unsignedTransaction || BigInt(fresh.maximumFee) > BigInt(r.maximumFee) || fresh.accountRent !== r.accountRent) throw new Error("Account, token or fee conditions changed. Request a new offline approval.");
}
export async function preflightMulti(r: MultiRequest, rpc: Rpc, sol: Connection) { return r.network === "robinhood" ? preflightErc20(r, rpc) : preflightSol(r, sol); }
