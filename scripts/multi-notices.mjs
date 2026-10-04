// Generate third-party notices from installed package metadata/license files, never user files.
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),store=join(root,'node_modules','.pnpm');
const notices=[];
for(const entry of await readdir(store,{withFileTypes:true})){
 if(!entry.isDirectory()||entry.name==='node_modules')continue;
 const modules=join(store,entry.name,'node_modules');let names;try{names=await readdir(modules,{withFileTypes:true});}catch{continue;}
 const dirs=[];for(const name of names){if(name.isSymbolicLink()||!name.isDirectory())continue;if(name.name.startsWith('@')){for(const child of await readdir(join(modules,name.name),{withFileTypes:true}))if(child.isDirectory()&&!child.isSymbolicLink())dirs.push(join(modules,name.name,child.name));}else dirs.push(join(modules,name.name));}
 for(const dir of dirs){let pkg;try{pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));}catch{continue;}let text=`\n${pkg.name} ${pkg.version}\nLicense declaration: ${JSON.stringify(pkg.license??'See package source')}\n`;
 for(const file of await readdir(dir,{withFileTypes:true})){if(file.isFile()&&/^(license|licence|copying|notice)(\.|$)/i.test(file.name)){text+='\n'+file.name+'\n'+await readFile(join(dir,file.name),'utf8');}}
 notices.push(text);
 }
}
await mkdir(join(root,'outputs','multi-v5'),{recursive:true});
await writeFile(join(root,'outputs','multi-v5','THIRD-PARTY-NOTICES.txt'),'Installed dependency notices (superset of bundled modules). Original image notices are also retained.\n'+notices.sort().join('\n---\n'));
console.log('Generated notices for '+notices.length+' packages.');
