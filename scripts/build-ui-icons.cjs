// Build PNGs once; Tk never parses SVG or accesses the network.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
async function main() {
  const source=path.join(root,'public/icons'), target=path.join(root,'packaging/ui-icons');
  await fs.mkdir(target,{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(source,'PROVENANCE.json'),'utf8'));
  for(const record of manifest.files.filter(r=>r.file.endsWith('.svg'))) {
    let svg=await fs.readFile(path.join(source,record.file),'utf8');
    const ui=record.file.startsWith('lucide/');
    if(ui) svg=svg.replaceAll('currentColor','#ffffff').replace('stroke-width="2"','stroke-width="1.75"');
    const name=(ui?'':'asset-')+path.basename(record.file,'.svg')+'.png';
    await sharp(Buffer.from(svg)).resize(96,96).png().toFile(path.join(target,name));
  }
  await fs.copyFile(path.join(source,'lucide/LICENSE'),path.join(target,'LUCIDE-LICENSE'));
  await fs.copyFile(path.join(source,'crypto/LICENSE.md'),path.join(target,'CRYPTO-LICENSE.md'));
  await fs.copyFile(path.join(source,'PROVENANCE.json'),path.join(target,'PROVENANCE.json'));
  console.log('Built 42 local high-resolution PNG assets. UI stroke: 1.75 at 24px.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
