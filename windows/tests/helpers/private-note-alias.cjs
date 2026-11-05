'use strict';
// Keep SDK preprocessing and note decoding in one explicit test-only bundle.
const fs=require('node:fs/promises'),path=require('node:path');let loaded;
async function aliasRequest(f){if(!loaded)loaded=(async()=>{const directory=await fs.mkdtemp(path.resolve(__dirname,'../../verification/note-alias-')),file=path.join(directory,'fixture.cjs');await require('esbuild').build({entryPoints:[path.join(__dirname,'private-note-alias.ts')],outfile:file,bundle:true,platform:'node',format:'cjs',target:'node24'});return require(file);})();return (await loaded).aliasRequest(f);}
module.exports={aliasRequest};
