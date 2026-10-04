// Build-only deterministic conversion. Runtime does not require SVG or sharp.
const fs=require('node:fs'); const path=require('node:path'); const sharp=require('sharp');
const dir=path.join(__dirname,'../packaging/chain-icons');
(async()=>{
 const result={};
 for(const name of ['eth','sol','bnb']){
  const source=fs.readFileSync(path.join(dir,name+'.svg'),'utf8');
  let paths;
  if(name==='eth') paths=source.match(/<g fill="#FFF" fill-rule="nonzero">([\s\S]*?)<\/g>/)[1];
  else if(name==='sol') paths=source.match(/<path d="M9\.925[\s\S]*?\/>/)[0];
  else paths=source.match(/<path id="e"[^>]*\/>/)[0].replace('id="e"','fill="#FFF"');
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 2 26 26"><g fill="#FFF">'+paths+'</g></svg>';
  const {data,info}=await sharp(Buffer.from(svg)).resize(24,12,{fit:'fill'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  result[name]=Array.from({length:12},(_,y)=>Array.from({length:24},(_,x)=>{
   const i=(y*info.width+x)*4;const v=(data[i]+data[i+1]+data[i+2])/3*data[i+3]/255;
   return ' .:+#'[v<16?0:Math.min(4,Math.ceil(v/64))];
  }).join(''));
 }
 fs.writeFileSync(path.join(dir,'terminal.json'),JSON.stringify(result,null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});

