// This worker only receives explicitly supplied bytes. No path, password or key API.
import {parseStrictPublicJson} from '../core/strict-public-json';
import {encodeSetupFrame,encodeVaultFrame} from './savings-boundary-codec';
import {encodeSavingsExpectationFrame,encodeSavingsActionRequestFrame} from './savings-action-codec';
import {readBoundedPipe} from './bounded-pipe';
async function main(){
 if(process.argv.length!==3||!['setup','vault','expectation','action'].includes(process.argv[2]))throw Error('Unsupported parsing purpose.');
 const purpose=process.argv[2],limit=['expectation','action'].includes(purpose)?16384:32768;
 const raw=await readBoundedPipe(process.stdin,limit);
 const value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),limit);
 process.stdout.write(purpose==='setup'?encodeSetupFrame(value):purpose==='vault'?encodeVaultFrame(value):purpose==='expectation'?encodeSavingsExpectationFrame(value):encodeSavingsActionRequestFrame(value));
}
main().catch(()=>{process.stderr.write('Public input rejected.');process.exitCode=1;});
