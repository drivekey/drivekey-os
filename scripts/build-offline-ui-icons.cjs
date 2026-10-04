// Re-render licensed vector sources for the offline desktop only.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
async function main() {
  const source=path.join(root,'public/icons'), target=path.join(root,'packaging/ui-icons');
  const manifest=JSON.parse(await fs.readFile(path.join(source,'PROVENANCE.json'),'utf8'));
  const rendered=[];
  for (const record of manifest.files.filter(r=>r.file.endsWith('.svg'))) {
    const bytes=await fs.readFile(path.join(source,record.file));
    if(hash(bytes)!==record.sha256) throw new Error('Vector provenance mismatch: '+record.file);
    let svg=bytes.toString('utf8');
    const ui=record.file.startsWith('lucide/');
    if(ui) svg=svg.replaceAll('currentColor','#ffffff').replace('stroke-width="2"','stroke-width="1.75"');
    // Preserve licensed symbol paths; remove coin discs for compact chain marks.
    if(record.file==='crypto/eth.svg') svg=svg.replace(/<circle[^>]*\/>/g,'').replaceAll('#FFF','#b8bfdc');
    if(record.file==='crypto/sol.svg') {
      svg=svg.replace(/<circle[^>]*\/>/g,'').replace('fill="#FFF"','fill="url(#sol-gradient)"');
      svg=svg.replace('<g fill="none">','<defs><linearGradient id="sol-gradient" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><g fill="none">');
    }
    const name=(ui?'':'asset-')+path.basename(record.file,'.svg')+'.png';
    let pipeline=sharp(Buffer.from(svg),{density:576}).resize(192,192);
    // Crop transparent margins before final sampling for readable small marks.
    if(record.file==='crypto/eth.svg'||record.file==='crypto/sol.svg') {
      const buffer=await pipeline.png().toBuffer();
      pipeline=sharp(buffer).trim().resize(192,192,{fit:'contain',background:'#00000000'});
    }
    const png=await pipeline.png().toBuffer();await fs.writeFile(path.join(target,name),png);
    rendered.push({file:name,width:192,height:192,sha256:hash(png),vector:record.file,sourceSha256:record.sha256});
  }
  await fs.writeFile(path.join(target,'RC17-RENDER.json'),JSON.stringify({scope:'Offline desktop only',source:'Existing pinned Lucide and CC0 cryptocurrency vectors',utilityStroke:1.75,displayPixels:[14,16,18,20],changes:'192px source sampling; ETH disc removed; SOL disc removed and gradient applied to original licensed symbol paths',files:rendered},null,2));
  console.log('Rendered '+rendered.length+' hash-verified vector icons at 192px.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
