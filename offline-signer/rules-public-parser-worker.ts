import {readBoundedPipe} from './bounded-pipe';
import {parseStrictPublicJson} from '../core/strict-public-json';
import {encodeRulesPublic,type RulesPurpose} from './rules-boundary-codec';
async function main(){const purpose=process.argv[2];if(process.argv.length!==3||!['rules-context','rules-draft','rules-approval'].includes(purpose))throw Error('Unsupported rules parser purpose');const raw=await readBoundedPipe(process.stdin,32768);const value=parseStrictPublicJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),32768);process.stdout.write(encodeRulesPublic(purpose as RulesPurpose,value));}
main().catch(()=>{process.stderr.write('Rules public input rejected.');process.exitCode=1;});
