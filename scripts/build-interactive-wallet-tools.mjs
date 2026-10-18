// Host-only synthetic acceptance tools. Never copy these into the OS payload.
import {build,version as esbuildVersion} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
if(esbuildVersion!=='0.25.12')throw Error('Use pinned esbuild 0.25.12');
const output=path.join(root,'outputs/funds-wallet-tools');mkdirSync(output,{recursive:true});
const sources=['prepare-interactive-wallet-transfer','verify-interactive-wallet-output','verify-interactive-native-transfer'];
const result=await build({absWorkingDir:root,entryPoints:sources.map(x=>'scripts/'+x+'.ts'),bundle:true,platform:'node',format:'esm',packages:'external',outdir:output,outExtension:{'.js':'.mjs'},metafile:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest={kind:'host-only-wallet-acceptance-tools',node:process.version,esbuild:esbuildVersion,notPackagedInRuntime:true,requiresHashBoundLocalSourceArchive:true,sourceFiles:Object.fromEntries(Object.keys(result.metafile.inputs).map(p=>[p,hash(path.resolve(root,p))])),externalImports:[...new Set(Object.values(result.metafile.outputs).flatMap(x=>x.imports.filter(y=>y.external).map(y=>y.path)))].sort(),packageJsonSha256:hash(path.join(root,'package.json')),lockfileSha256:hash(path.join(root,'pnpm-lock.yaml')),outputFiles:Object.fromEntries(sources.map(x=>[x+'.mjs',hash(path.join(output,x+'.mjs'))]))};
writeFileSync(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({output,sourceCount:Object.keys(manifest.sourceFiles).length,externalImports:manifest.externalImports}));
