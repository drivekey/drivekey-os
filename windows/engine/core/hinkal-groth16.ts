// Offline, single-thread Groth16 equation using the pinned snarkjs curve API.
// Never reduce untrusted coordinates modulo the field before validation.
export const HINKAL_SCALAR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const HINKAL_BASE_FIELD=21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export async function verifyGroth16Calldata(key:any,signals:unknown[],proof:{a:unknown[];b:unknown[][];c:unknown[]}){
 let curve:any;
 try{
  if(key.protocol!=='groth16'||key.curve!=='bn128'||!Number.isSafeInteger(key.nPublic)||key.nPublic<1||key.nPublic>64||signals.length!==key.nPublic||key.IC.length!==signals.length+1||proof.a.length!==2||proof.b.length!==2||proof.b.some(row=>row.length!==2)||proof.c.length!==2)throw Error();
  const pub=signals.map(value=>BigInt(value as any)),coordinates=[...proof.a,...proof.b.flat(),...proof.c].map(value=>BigInt(value as any));
  if(pub.some(n=>n<0n||n>=HINKAL_SCALAR)||coordinates.some(n=>n<0n||n>=HINKAL_BASE_FIELD))throw Error();
  curve=await require('snarkjs').curves.getCurveFromName('bn128',{singleThread:true});
  const {G1,G2}=curve,toBig=(value:any):any=>Array.isArray(value)?value.map(toBig):BigInt(value);
  let aggregate=G1.fromObject(toBig(key.IC[0]));for(let i=0;i<pub.length;i++)aggregate=G1.add(aggregate,G1.timesScalar(G1.fromObject(toBig(key.IC[i+1])),pub[i]));
  const a=G1.fromObject([...coordinates.slice(0,2),1n]),b=G2.fromObject([[coordinates[3],coordinates[2]],[coordinates[5],coordinates[4]],[1n,0n]]),c=G1.fromObject([...coordinates.slice(6,8),1n]);
  if(!G1.isValid(a)||!G2.isValid(b)||!G1.isValid(c)||G1.isZero(a)||G2.isZero(b)||G1.isZero(c)||!G2.isZero(G2.timesScalar(b,HINKAL_SCALAR)))throw Error();
  if(!await curve.pairingEq(G1.neg(a),b,aggregate,G2.fromObject(toBig(key.vk_gamma_2)),c,G2.fromObject(toBig(key.vk_delta_2)),G1.fromObject(toBig(key.vk_alpha_1)),G2.fromObject(toBig(key.vk_beta_2))))throw Error();
  return true;
 }catch{throw Error('Groth16 proof, coordinates or public signals are invalid.');}finally{if(curve)await curve.terminate();}
}
