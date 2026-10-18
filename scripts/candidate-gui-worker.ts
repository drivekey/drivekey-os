// Candidate-only launch gate around the public broker dispatcher. Key handling
// remains exclusively in the fixed, separately confined worker entrypoints.
import {candidateLaunchCheck,candidateLaunchFailureMessage} from './candidate-launch-check';
import {readBoundedPipe} from '../offline-signer/bounded-pipe';
import {assertCliSecretPolicy} from '../offline-signer/cli-terminal';
import {decodeGuiCommand,dispatchGuiCommand} from '../offline-signer/gui-dispatch';
import {safeGuiError} from '../offline-signer/gui-service';

async function main() {
 if(process.platform!=='linux'||!(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--diagnose')))throw Error('Unsupported candidate invocation.');
 // A child setting core0 cannot protect its parent. Check this process before stdin.
 await assertCliSecretPolicy();
 const launch=candidateLaunchCheck(),launchPassed=launch.passed;
 if(process.argv[2]==='--diagnose'){
  process.stdout.write(JSON.stringify({kind:'drivekey-candidate-broker-diagnostic',coreLimitEnforced:true,launchPassed,launch,inputRead:false,chainAuthenticated:false,fundingReady:false,productionReady:false}));return;
 }
 if(!launchPassed){
  process.stdout.write(JSON.stringify({ok:false,error:candidateLaunchFailureMessage(launch.failure),diagnostic:{stage:'candidate-launch-policy',...launch,inputRead:false},fundingReady:false,productionReady:false}));
  process.exitCode=1;return;
 }
 const raw=await readBoundedPipe(process.stdin,65536);
 try{
  const result=await dispatchGuiCommand(decodeGuiCommand(raw),'/mnt/drivekey/DriveKey');
  process.stdout.write(JSON.stringify(result));if(!result.ok)process.exitCode=1;
 }finally{raw.fill(0);}
}
main().catch(error=>{
 process.stdout.write(JSON.stringify({ok:false,error:safeGuiError(error),fundingReady:false,productionReady:false}));
 process.exitCode=1;
});
