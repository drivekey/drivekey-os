// Separate, unsigned read-only qualification source. No wallet/profile copy.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fingerprint} from './fingerprint.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=createRequire(import.meta.url),{qualificationFromPackage}=local('./public-history-qualification.cjs');
export async function createPublicHistoryLab({outputRoot,profileId=randomUUID()}={}){
 if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot))throw Error('Choose an absolute qualification workspace directory.');
 const base=await fingerprint(root),metadata={version:1,mode:'public-history-read-only',profileId,baseSourceFingerprint:base.fingerprint};qualificationFromPackage({drivekeyQualification:metadata});
 const source=await fs.mkdtemp(path.join(path.resolve(outputRoot),'drivekey-public-history-lab-source-'));
 for(const [name,expected]of Object.entries(base.sourceHashes)){const from=path.join(root,name),to=path.join(source,name),bytes=await fs.readFile(from);if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Normal source changed while making the lab copy.');await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes,{flag:'wx'});}
 const packageFile=path.join(source,'package.json'),pkg=JSON.parse(await fs.readFile(packageFile,'utf8'));if(pkg.drivekeyQualification!==undefined)throw Error('Create the lab from the normal source only.');pkg.name='drivekey-public-history-qualification';pkg.description='Internal read-only public ciphertext-history qualification. No wallet access, signing or submissions.';pkg.drivekeyQualification=metadata;await fs.writeFile(packageFile,JSON.stringify(pkg,null,2)+'\n');
 for(const name of ['LICENSE']){try{await fs.copyFile(path.join(root,name),path.join(source,name),fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='ENOENT')throw e;}}
 await fs.symlink(await fs.realpath(path.join(root,'node_modules')),path.join(source,'node_modules'),'junction');
 const copied=await fingerprint(source),report={createdAt:new Date().toISOString(),mode:metadata.mode,profileId,baseSourceFingerprint:base.fingerprint,sourceFingerprint:copied.fingerprint,source,copiedPublicSourceFiles:Object.keys(base.sourceHashes).length,normalSourceUnchanged:(await fingerprint(root)).fingerprint===base.fingerprint,walletsOrProfilesCopied:false,productionFeaturesEnabled:false,financialSigningAllowed:false,submissionReady:false};if(!report.normalSourceUnchanged)throw Error('Normal source changed while making the lab copy.');await fs.writeFile(path.join(source,'QUALIFICATION-SOURCE.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const options={};for(const arg of process.argv.slice(2)){if(arg.startsWith('--output-root='))options.outputRoot=arg.slice(14);else if(arg.startsWith('--profile-id='))options.profileId=arg.slice(13);else throw Error('Usage: node tools/create-public-history-lab.mjs --output-root=ABSOLUTE_DIRECTORY [--profile-id=UUID]');}console.log(JSON.stringify(await createPublicHistoryLab(options)));}
