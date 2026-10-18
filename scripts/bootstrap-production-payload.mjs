// New production-only application payload. Does not build, boot or sign an OS.
import { build, version as esbuildVersion } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { targets } from './production-worker-targets.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = data => createHash('sha256').update(data).digest('hex');
export function safeInput(name) {
  if (isAbsolute(name) || name.includes('\\') || name.split('/').some((p,i,a) => !p || p === '..' || (p.startsWith('.') && !(p === '.pnpm' && a[i-1] === 'node_modules'))))
    throw Error('Unsafe input path: ' + name);
  if (/(^|\/)(tests?|credentials|wallet-output|wallets|secrets)(\/|$)|fixture|research|(?:^|\/)test-|smoke/i.test(name))
    throw Error('Nonproduction input: ' + name);
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(name)) throw Error('Secret-file input');
  return name;
}
async function local(name) {
  safeInput(name);
  const p = resolve(root, name), actual = await realpath(p);
  if (!actual.startsWith(root + sep) || (await lstat(p)).isSymbolicLink()) throw Error('Escaping/link input: ' + name);
  return readFile(p);
}
export function compareLock(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Error('Production closure/toolchain differs from lock');
}
async function plan() {
  if (process.env.ESBUILD_BINARY_PATH) throw Error('Unpinned esbuild executable override');
  const tsconfigRaw = JSON.parse(await local('tsconfig.json'));
  if (tsconfigRaw.extends) throw Error('Extended TypeScript config needs explicit source closure');
  const inputs = new Set(['scripts/bootstrap-production-payload.mjs', 'scripts/production-worker-targets.mjs', 'package.json', 'pnpm-lock.yaml','tsconfig.json',
    'packaging/production-proof-dependencies/package.json','packaging/production-proof-dependencies/pnpm-lock.yaml']);
  const output = new Map();
  for (const [entry, name] of targets) {
    safeInput(entry);
    const result = await build({absWorkingDir: root, entryPoints: [entry], outfile: name,
      bundle: true, platform: 'node', format: 'cjs', target: 'node22', metafile: true, write: false,tsconfigRaw,
      plugins:[{name:'production-proof-library',setup(b){
        b.onResolve({filter:/savings-inclusion-research\/library$/},()=>({path:resolve(root,'packaging/production-proof-dependencies/library.ts')}));
      }}]});
    for (const name of Object.keys(result.metafile.inputs)) inputs.add(safeInput(name));
    if (result.outputFiles.length !== 1) throw Error('Unexpected compiler output');
    output.set('opt/drivekey/' + name, result.outputFiles[0].contents);
  }
  async function copy(source, destination) {
    inputs.add(safeInput(source)); output.set(destination, await local(source));
  }
  // GUI modules are source, not tests; never import or execute them here.
  for (const name of (await readdir(resolve(root, 'packaging'))).sort()) {
    if (name.endsWith('.py')) await copy('packaging/' + name, 'opt/drivekey/' + name);
  }
  async function assets(source, destination) {
    for (const e of (await readdir(resolve(root, source), {withFileTypes: true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (e.name === '__pycache__' || /\.pyc?$/.test(e.name)) continue;
      if (e.isSymbolicLink()) throw Error('Asset symlink');
      if (e.isDirectory()) await assets(source + '/' + e.name, destination + '/' + e.name);
      else if (e.isFile()) await copy(source + '/' + e.name, destination + '/' + e.name);
    }
  }
  await assets('packaging/ui-icons','opt/drivekey/ui-icons');
  await assets('packaging/fonts','opt/drivekey/fonts');
  for (const [src,dst] of [['public/brand/mark.png','brand/mark.png'],['LICENSE','LICENSES/DriveKey.txt'],
    ['scripts/candidate-launch-policy.py','drivekey-candidate-policy.py'],['scripts/candidate-broker-launch.py','drivekey-candidate-broker.py']])
    await copy(src,'opt/drivekey/'+dst);
  const require = createRequire(import.meta.url);
  const esbuildApi = relative(root, require.resolve('esbuild')).split(sep).join('/');
  const binaryPackage = '@esbuild/' + process.platform + '-' + process.arch;
  const executable = createRequire(require.resolve('esbuild')).resolve(binaryPackage + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
  inputs.add(esbuildApi); inputs.add(relative(root, executable).split(sep).join('/'));
  for (const name of [...inputs]) {
    const start=name.lastIndexOf('node_modules/');
    if(start>=0){const tail=name.slice(start+13).split('/'),count=tail[0].startsWith('@')?2:1;
      inputs.add(name.slice(0,start+13)+tail.slice(0,count).join('/')+'/package.json');}
  }
  const sources = {};
  for (const name of [...inputs].sort()) sources[name] = hash(await local(name));
  const artifacts = {};
  for (const [name,data] of [...output].sort(([a],[b])=>a.localeCompare(b))) artifacts[name] = {bytes:data.length,sha256:hash(data)};
  return {output, lock:{schema:1,kind:'drivekey-production-payload-lock',
    toolchain:{nodeVersion:process.version,nodeSha256:hash(await readFile(process.execPath)),platform:process.platform,arch:process.arch,esbuildVersion},
    sources,artifacts,upstreamAuthenticated:false,completeOSBuild:false,fundingReady:false}};
}
export async function main(args) {
  const [mode, lockPath, destination] = args;
  if (!['record-lock','build'].includes(mode) || !lockPath || (mode === 'build' ? !destination || args.length !== 3 : args.length !== 2))
    throw Error('Usage: record-lock NEW_LOCK | build LOCK NEW_DIRECTORY');
  const {output,lock} = await plan();
  if (mode === 'record-lock') {
    await writeFile(lockPath,JSON.stringify(lock,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({lock:lockPath,workers:targets.length,sources:Object.keys(lock.sources).length,upstreamAuthenticated:false})); return;
  }
  compareLock(JSON.parse(await readFile(lockPath,'utf8')),lock);
  await mkdir(destination); // Must be new; never overwrite published artifacts.
  for (const [name,data] of output) { const path=resolve(destination,name); await mkdir(dirname(path),{recursive:true}); await writeFile(path,data,{flag:'wx'}); }
  await writeFile(resolve(destination,'production-payload.json'),JSON.stringify(lock,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({destination,workers:targets.length,artifacts:output.size,completeOSBuild:false,fundingReady:false}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
