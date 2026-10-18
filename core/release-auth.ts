// Candidate verification only. Boot-ROM trust provisioning and rollback storage
// are separate hardware release gates; this module does not install firmware.
import {createPublicKey,verify,createHash} from 'node:crypto';
import {z} from 'zod';
const integer=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const digest=z.string().regex(/^[0-9a-f]{64}$/);
export const releaseManifestSchema=z.object({
 kind:z.literal('drivekey-authenticated-release'),version:z.literal(1),
 product:z.enum(['drivekey-offline','drivekey-hardware']),hardwareRevision:z.string().regex(/^[a-z0-9-]{1,40}$/),
 channel:z.enum(['candidate','production']),releaseVersion:z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
 sequence:integer.min(1),minimumBootVersion:integer,
 payloadBytes:integer.min(1),payloadSha256:digest,sourceSha256:digest,
 createdAt:z.string().datetime(),expiresAt:z.string().datetime(),
}).strict();
export type ReleaseManifest=z.infer<typeof releaseManifestSchema>;
const approvalSchema=z.object({keyId:z.string().regex(/^[a-z0-9-]{1,40}$/),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict();
const bundleSchema=z.object({manifest:releaseManifestSchema,approvals:z.array(approvalSchema).length(2)}).strict();
const trustSchema=z.object({product:z.enum(['drivekey-offline','drivekey-hardware']),hardwareRevision:z.string(),
 keys:z.array(z.object({keyId:z.string(),publicKeyPem:z.string().max(2048).regex(/^-----BEGIN PUBLIC KEY-----/)}).strict()).length(3),
 allowProduction:z.literal(false),
}).strict();
const stateSchema=z.object({installedSequence:integer,bootVersion:integer}).strict();
export function releaseSigningBytes(input:unknown):Buffer {
 return Buffer.from('DriveKey release authorization v1\n'+JSON.stringify(releaseManifestSchema.parse(input)),'utf8');
}
export function verifyReleaseCandidate(input:unknown,trustInput:unknown,stateInput:unknown,artifact:{sha256:string;bytes:number},now=Date.now()) {
 const {manifest,approvals}=bundleSchema.parse(input),trust=trustSchema.parse(trustInput),state=stateSchema.parse(stateInput);
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid verifier clock.');
 if(manifest.product!==trust.product||manifest.hardwareRevision!==trust.hardwareRevision||manifest.channel!=='candidate')throw Error('Wrong product, model or release channel.');
 const created=Date.parse(manifest.createdAt),expiry=Date.parse(manifest.expiresAt);
 if(created>now||expiry<=now||expiry<=created||expiry-created>90*86400000)throw Error('Release metadata is expired or invalid.');
 if(manifest.sequence<=state.installedSequence||manifest.minimumBootVersion>state.bootVersion)throw Error('Rollback or incompatible boot verifier.');
 if(manifest.payloadSha256!==digest.parse(artifact.sha256)||manifest.payloadBytes!==integer.min(1).parse(artifact.bytes))throw Error('Release payload differs.');
 const keyIds=new Set<string>(),keyIdentities=new Set<string>();
 const trusted=new Map(trust.keys.map(entry=>{
  const key=createPublicKey(entry.publicKeyPem);if(key.asymmetricKeyType!=='ed25519')throw Error('Unsupported release trust key.');
  const identity=createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
  if(keyIds.has(entry.keyId)||keyIdentities.has(identity))throw Error('Release roots must be independent keys.');
  keyIds.add(entry.keyId);keyIdentities.add(identity);return [entry.keyId,key] as const;
 }));
 const accepted=new Set<string>(),bytes=releaseSigningBytes(manifest);
 for(const approval of approvals){
  const key=trusted.get(approval.keyId),signature=Buffer.from(approval.signature,'base64');
  if(!key||accepted.has(approval.keyId)||signature.length!==64||signature.toString('base64')!==approval.signature||!verify(null,bytes,key,signature))throw Error('Release quorum signature invalid.');
  accepted.add(approval.keyId);
 }
 return {status:'candidate-authenticated' as const,sequence:manifest.sequence,signers:[...accepted],
  installationAuthorized:false as const,warning:'Provisioned boot trust, persistent rollback protection and hardware acceptance remain required.'};
}
