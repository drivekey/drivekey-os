'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction} = require('@solana/web3.js');
const {createTransferCheckedInstruction, getAssociatedTokenAddressSync} = require('@solana/spl-token');
const bs58 = require('bs58').default;
const {CHAINS} = require('../dist/payment.cjs');
const {SettlementVerifier} = require('../dist/checkout-verifier.cjs');

for (const asset of ['SOL', 'USDC']) test(`Solana ${asset} receipts cannot count the same net credit twice`, async () => {
  const payer = Keypair.generate(), merchant = Keypair.generate();
  const mint = new PublicKey(CHAINS.solana.usdc), blockhash = Keypair.generate().publicKey.toBase58();
  const [source, destination] = asset === 'SOL' ? [payer.publicKey, merchant.publicKey] :
    [payer, merchant].map(wallet => getAssociatedTokenAddressSync(mint, wallet.publicKey));
  const transfer = (from, to, owner) => asset === 'SOL' ? SystemProgram.transfer({fromPubkey:from,toPubkey:to,lamports:100}) :
    createTransferCheckedInstruction(from, mint, to, owner.publicKey, 100, 6);
  const incoming = transfer(source, destination, payer), outgoing = transfer(destination, source, merchant);
  const invoice = {chain:'solana', asset, address:merchant.publicKey.toBase58()};

  async function verify(instructions, signers) {
    const message = new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:blockhash,instructions}).compileToLegacyMessage();
    const transaction = new VersionedTransaction(message);
    transaction.sign(signers);
    const accountIndex = message.staticAccountKeys.findIndex(key => key.equals(destination));
    const hash = bs58.encode(transaction.signatures[0]);
    const value = {slot:100,blockTime:1793534410,transaction:[Buffer.from(transaction.serialize()).toString('base64'),'base64'],meta:{err:null}};
    if (asset === 'SOL') {
      value.meta.preBalances = message.staticAccountKeys.map(() => 1000);
      value.meta.postBalances = [...value.meta.preBalances];
      value.meta.postBalances[accountIndex] += 100;
    } else {
      const token = amount => ({accountIndex,mint:mint.toBase58(),owner:invoice.address,uiTokenAmount:{amount,decimals:6}});
      value.meta.preTokenBalances = [token('20')];
      value.meta.postTokenBalances = [token('120')];
    }
    const verifier = new SettlementVerifier({identity:async chain=>assert.equal(chain,'solana'),rpc:async (chain,method,[signature,options])=>{
      assert.equal(chain,'solana');assert.equal(method,'getTransaction');assert.equal(signature,hash);assert.equal(options.commitment,'finalized');return value;
    }});
    return verifier.verify(invoice,hash);
  }

  const single = await verify([incoming],[payer]);
  assert.equal(single.length,1);
  assert.equal(single[0].amount,'100');
  await assert.rejects(()=>verify([incoming,incoming,outgoing],[payer,merchant]),/Ambiguous Solana invoice credit/);
});
