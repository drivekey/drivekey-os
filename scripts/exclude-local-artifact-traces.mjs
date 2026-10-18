// Next 16's Windows trace exclusion matching leaves local ISO globs in route traces.
// Enforce the configured exclusions after building. Local downloads still read their
// separately provisioned artifacts; hosted downloads use the existing release URL.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function excludeLocalArtifactTraces(root=process.cwd()){
 root=path.resolve(root);
 const excluded=['outputs','work'].map(name=>path.join(root,name)+path.sep);
 let traces=0,removed=0;
 async function visit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const filename=path.join(directory,entry.name);
   if(entry.isDirectory())await visit(filename);
   else if(entry.isFile()&&entry.name.endsWith('.nft.json')){
    const trace=JSON.parse(await readFile(filename,'utf8'));
    if(!Array.isArray(trace.files)||trace.files.some(file=>typeof file!=='string'))throw Error('Invalid generated trace manifest');
    const files=trace.files.filter(file=>!excluded.some(prefix=>path.resolve(directory,file).startsWith(prefix)));
    if(files.length!==trace.files.length){removed+=trace.files.length-files.length;traces++;await writeFile(filename,JSON.stringify({...trace,files})+'\n');}
   }
  }
 }
 await visit(path.join(root,'.next','server'));
 return {traces,removed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await excludeLocalArtifactTraces()));
