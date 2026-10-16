// Host-only public release review tools; never generate signing keys or approvals.
import {build,version as esbuildVersion} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
if(esbuildVersion!=='0.25.12')throw Error('Use pinned esbuild 0.25.12');
if(process.argv.length!==3)throw Error('Usage: node scripts/build-release-review-tools.mjs NEW_OUTPUT_DIRECTORY');
const output=path.resolve(process.argv[2]);mkdirSync(output);
const sources=['prepare-release-review-request','verify-release-candidate'];
const result=await build({absWorkingDir:root,entryPoints:sources.map(x=>'scripts/'+x+'.ts'),bundle:true,platform:'node',format:'esm',packages:'external',outdir:output,outExtension:{'.js':'.mjs'},metafile:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest={kind:'host-only-public-release-review-tools',node:process.version,esbuild:esbuildVersion,notPackagedInRuntime:true,createsAuthority:false,sourceFiles:Object.fromEntries(Object.keys(result.metafile.inputs).map(p=>[p,hash(path.resolve(root,p))])),externalImports:[...new Set(Object.values(result.metafile.outputs).flatMap(x=>x.imports.filter(y=>y.external).map(y=>y.path)))].sort(),packageJsonSha256:hash(path.join(root,'package.json')),lockfileSha256:hash(path.join(root,'pnpm-lock.yaml')),outputFiles:Object.fromEntries(sources.map(x=>[x+'.mjs',hash(path.join(output,x+'.mjs'))]))};
writeFileSync(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,sourceCount:Object.keys(manifest.sourceFiles).length,externalImports:manifest.externalImports}));
