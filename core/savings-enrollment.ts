import {z} from 'zod';
import {AbiCoder, concat, getAddress, getCreateAddress, keccak256, toUtf8Bytes, Transaction, ZeroAddress} from 'ethers';
import {savingsConfigSchema, savingsConfigHash, SAVINGS_USDC} from './savings-protocol';
import {parseStrictPublicJson} from './strict-public-json';

/** Exact LOCAL CANDIDATE identity, not an audit, a release root or chain authentication. */
export const SAVINGS_V1_BUILD_IDENTITY = Object.freeze({
  contract: 'DriveKeySavingsV1', sourcePath: 'contracts/DriveKeySavingsV1.sol',
  compiler: '0.8.30+commit.73712a01.Emscripten.clang',
  sourceHash: '0xaa4829db3da2ab319fa2991c76bc0d7c337f3c65101e153db169eb38b70b3f29',
  settingsHash: '0xfec828951f6769f404a18a4b6faf7ecf4f51d51c242d7774e4599e2293d56bc3',
  creationCodeHash: '0xd1cc0f6869c3665c040a64ba648a5644af02bbf22ab2e020e389a803ddaed7b8',
  runtimeCodeHash: '0x2d3396ab6cc081b2bd7fa3dcf691743160e077ebd40c3038529b69f7bb84b38e',
});
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => {
  try {return getAddress(value) !== ZeroAddress;} catch {return false;}
}, 'Invalid nonzero address').transform(getAddress);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase());
const integer = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).refine(value => BigInt(value) < 2n ** 256n, 'Integer overflow');
const positiveInteger = integer.refine(value => BigInt(value) > 0n, 'Expected a positive integer');
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const bytes = (maximum: number) => z.string().max(2 + maximum * 2).regex(/^0x(?:[0-9a-fA-F]{2})+$/).transform(value => value.toLowerCase());

export const savingsBuildArtifactSchema = z.object({
  kind: z.literal('drivekey-savings-build'), version: z.literal(1), chainId: z.literal(1),
  contract: z.literal('DriveKeySavingsV1'), contractVersion: z.literal(1),
  compiler: z.literal(SAVINGS_V1_BUILD_IDENTITY.compiler), sourceHash: hash, settingsHash: hash,
  creationCode: bytes(49152), runtimeCode: bytes(24576),
}).strict();
export type SavingsBuildArtifact = z.infer<typeof savingsBuildArtifactSchema>;

/** Kept separate from a host proposal. Callers must obtain this intent independently. */
export const savingsEnrollmentIntentSchema = z.object({
  kind: z.literal('drivekey-savings-enrollment-intent'), version: z.literal(1),
  chainId: z.literal(1), contractVersion: z.literal(1), mechanism: z.literal('direct-create'),
  deployer: address, nonce: counter, expectedVault: address, configuration: savingsConfigSchema,
  gasLimit: positiveInteger, maxFeePerGas: positiveInteger, maxPriorityFeePerGas: integer,
}).strict().superRefine((intent, context) => {
  if (BigInt(intent.maxPriorityFeePerGas) > BigInt(intent.maxFeePerGas)) context.addIssue({code: 'custom', message: 'Priority fee exceeds the total fee cap'});
  if (intent.expectedVault === intent.deployer || intent.configuration.signers.includes(intent.expectedVault)) context.addIssue({code: 'custom', message: 'Vault cannot also be its deployer or signer'});
});
export type SavingsEnrollmentIntent = z.infer<typeof savingsEnrollmentIntentSchema>;
export const savingsDeploymentProposalSchema = z.object({
  kind: z.literal('drivekey-savings-deployment-proposal'), version: z.literal(1), unsignedTransaction: bytes(52000),
}).strict();
export const savingsSignedDeploymentSchema = z.object({
  kind: z.literal('drivekey-savings-signed-deployment'), version: z.literal(1), rawTransaction: bytes(52000),
}).strict();

const block = z.object({number: counter, hash}).strict();
export const savingsEnrollmentObservationSchema = z.object({
  kind: z.literal('drivekey-savings-enrollment-observation'), version: z.literal(1),
  provenance: z.literal('host-rpc'), chainId: z.literal(1), observedAt: z.string().datetime(),
  receipt: z.object({transactionHash: hash, status: z.literal(1), contractAddress: address, from: address, to: z.null(), block}).strict(),
  codeAt: z.object({address, block, runtimeCode: bytes(24576)}).strict(),
  stateAt: z.object({address, block, configuration: savingsConfigSchema, configurationHash: hash,
    epoch: z.literal(1), paused: z.literal(false), threshold: z.union([z.literal(1), z.literal(2)]),
    withdrawalDelay: z.union([z.literal(300), z.literal(900)]), securityDelay: z.literal(3600),
    maxLifetime: z.literal(86400), usdc: address, reportedChainId: z.literal(1),
  }).strict(),
}).strict();
export type SavingsEnrollmentObservation = z.infer<typeof savingsEnrollmentObservationSchema>;

/** File-import boundary: reject duplicate/escaped keys and excessive bytes/depth before normalization. */
export function parseSavingsEnrollmentPublicFile(text: string) {
  return z.union([savingsBuildArtifactSchema, savingsEnrollmentIntentSchema, savingsDeploymentProposalSchema,
    savingsSignedDeploymentSchema, savingsEnrollmentObservationSchema]).parse(parseStrictPublicJson(text, 131072));
}

/** Exact recipe, including source path and metadata. Changed source/build pins require a new reviewed candidate. */
export function savingsV1CompilerInput(source: string) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 65536 || keccak256(toUtf8Bytes(source)) !== SAVINGS_V1_BUILD_IDENTITY.sourceHash) throw Error('Savings source differs from the pinned local candidate');
  const settings = {
    optimizer: {enabled: true, runs: 200}, evmVersion: 'shanghai', metadata: {bytecodeHash: 'ipfs'},
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.bytecode.linkReferences', 'evm.deployedBytecode.immutableReferences']}},
  };
  if (keccak256(toUtf8Bytes(JSON.stringify(settings))) !== SAVINGS_V1_BUILD_IDENTITY.settingsHash) throw Error('Savings build recipe identity mismatch');
  return {language: 'Solidity', sources: {[SAVINGS_V1_BUILD_IDENTITY.sourcePath]: {content: source}}, settings};
}

export function verifySavingsBuildArtifact(input: unknown): SavingsBuildArtifact {
  const artifact = savingsBuildArtifactSchema.parse(input), identity = SAVINGS_V1_BUILD_IDENTITY;
  if (artifact.sourceHash !== identity.sourceHash || artifact.settingsHash !== identity.settingsHash ||
      keccak256(artifact.creationCode) !== identity.creationCodeHash || keccak256(artifact.runtimeCode) !== identity.runtimeCodeHash) throw Error('Savings artifact does not match the exact pinned local build');
  return artifact;
}

const limitations = Object.freeze({
  productionReady: false as const, deploymentReady: false as const, fundingReady: false as const,
  chainAuthenticated: false as const, receiptVerified: false as const, finalityVerified: false as const,
});

/** Byte comparison and address derivation only. Neither broadcasts nor grants signing authority. */
export function verifySavingsDeploymentProposal(artifactInput: unknown, expectedIntentInput: unknown, proposalInput: unknown) {
  const artifact = verifySavingsBuildArtifact(artifactInput), intent = savingsEnrollmentIntentSchema.parse(expectedIntentInput);
  const proposal = savingsDeploymentProposalSchema.parse(proposalInput), transaction = Transaction.from(proposal.unsignedTransaction);
  const constructorArguments = AbiCoder.defaultAbiCoder().encode(['uint8', 'address[]'], [intent.configuration.preset, intent.configuration.signers]);
  const initCode = concat([artifact.creationCode, constructorArguments]);
  if ((initCode.length - 2) / 2 > 49152) throw Error('Savings initialization code exceeds the bounded size');
  const expectedVault = getCreateAddress({from: intent.deployer, nonce: intent.nonce});
  if (expectedVault !== intent.expectedVault) throw Error('Expected savings address does not match deployer and nonce');
  if (transaction.type !== 2 || transaction.chainId !== 1n || transaction.to !== null || transaction.value !== 0n ||
      transaction.nonce !== intent.nonce || transaction.data !== initCode || transaction.isSigned() ||
      transaction.gasLimit !== BigInt(intent.gasLimit) || transaction.maxFeePerGas !== BigInt(intent.maxFeePerGas) ||
      transaction.maxPriorityFeePerGas !== BigInt(intent.maxPriorityFeePerGas) || (transaction.accessList?.length ?? 0) !== 0 ||
      transaction.unsignedSerialized !== proposal.unsignedTransaction) throw Error('Deployment bytes do not match the independently supplied intent');
  return {status: 'deployment-bytes-match-expected-intent' as const, expectedVault,
    deployer: intent.deployer, nonce: intent.nonce, configuration: intent.configuration,
    configurationHash: savingsConfigHash(intent.configuration), initCodeHash: keccak256(initCode),
    runtimeCodeHash: SAVINGS_V1_BUILD_IDENTITY.runtimeCodeHash,
    unsignedTransaction: transaction.unsignedSerialized, unsignedTransactionHash: transaction.unsignedHash,
    maximumNetworkFeeWei: (transaction.gasLimit * transaction.maxFeePerGas!).toString(),
    intentProvenance: 'caller-supplied-expectation; independent origin must be established outside this function' as const,
    ...limitations,
  };
}

/** Public signature verification, never a signer. A valid deployment signature is not an on-chain receipt. */
export function verifySavingsSignedDeployment(artifactInput: unknown, expectedIntentInput: unknown, proposalInput: unknown, signedInput: unknown) {
  const deployment = verifySavingsDeploymentProposal(artifactInput, expectedIntentInput, proposalInput);
  const signed = savingsSignedDeploymentSchema.parse(signedInput), transaction = Transaction.from(signed.rawTransaction);
  if (!transaction.isSigned() || transaction.from !== deployment.deployer || transaction.unsignedSerialized !== deployment.unsignedTransaction || transaction.serialized !== signed.rawTransaction || !transaction.hash) throw Error('Signed deployment differs from the exact expected transaction or deployer');
  return {...deployment, status: 'deployment-signature-matches-expected-intent' as const,
    signatureVerified: true as const, transactionHash: transaction.hash};
}

/** Compare untrusted host observations without converting them into authenticated chain evidence. */
export function compareSavingsEnrollmentObservation(artifactInput: unknown, expectedIntentInput: unknown, proposalInput: unknown, signedInput: unknown, observationInput: unknown) {
  const deployment = verifySavingsSignedDeployment(artifactInput, expectedIntentInput, proposalInput, signedInput);
  const observation = savingsEnrollmentObservationSchema.parse(observationInput), state = observation.stateAt;
  if (observation.receipt.transactionHash !== deployment.transactionHash || observation.receipt.contractAddress !== deployment.expectedVault ||
      observation.receipt.from !== deployment.deployer || observation.codeAt.address !== deployment.expectedVault || state.address !== deployment.expectedVault ||
      keccak256(observation.codeAt.runtimeCode) !== deployment.runtimeCodeHash || savingsConfigHash(state.configuration) !== deployment.configurationHash ||
      state.configurationHash !== deployment.configurationHash || state.threshold !== (deployment.configuration.preset === 0 ? 1 : 2) ||
      state.withdrawalDelay !== (deployment.configuration.preset === 0 ? 300 : 900) || state.usdc !== SAVINGS_USDC ||
      state.block.number !== observation.codeAt.block.number || state.block.hash !== observation.codeAt.block.hash ||
      state.block.number < observation.receipt.block.number ||
      (state.block.number === observation.receipt.block.number && state.block.hash !== observation.receipt.block.hash)) throw Error('Host-reported savings identity, receipt or initial state does not match');
  return {...deployment, status: 'host-observations-match-expected-deployment' as const,
    observationsMatch: true as const, evidenceProvenance: 'untrusted-host-rpc' as const,
    observedAt: observation.observedAt, observedBlock: state.block,
    warning: 'These RPC claims have not been independently authenticated. Matching bytes do not prove canonical-chain deployment, current state, finality, absence of pending actions or deposit safety.',
    ...limitations,
  };
}
