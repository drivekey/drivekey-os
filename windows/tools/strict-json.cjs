'use strict';
// Bounded JSON with duplicate keys rejected at every object nesting level.
function parseStrictJSON(text,maxBytes=256*1024,maxNodes=35000){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16*1024*1024||!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>1000000)throw Error('Invalid bounded JSON limits.');
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>maxBytes)throw Error('JSON file exceeds the size limit.');
 let value;try{value=JSON.parse(text);}catch{throw Error('Choose a valid JSON file.');}
 let offset=0,nodes=0;
 const fail=()=>{throw Error('JSON contains duplicate keys or exceeds its structural limit.');};
 const space=()=>{while(offset<text.length&&/\s/.test(text[offset]))offset++;};
 const string=()=>{const start=offset++;while(offset<text.length){const c=text[offset++];if(c==='\\')offset++;else if(c==='"')return JSON.parse(text.slice(start,offset));}fail();};
 function scan(depth){
  if(depth>40||++nodes>maxNodes)fail();space();const c=text[offset];
  if(c==='{'){offset++;space();const seen=new Set();if(text[offset]==='}'){offset++;return;}for(;;){space();const key=string();if(seen.has(key))fail();seen.add(key);space();offset++;scan(depth+1);space();if(text[offset++]==='}')return;}}
  else if(c==='['){offset++;space();if(text[offset]===']'){offset++;return;}for(;;){scan(depth+1);space();if(text[offset++]===']')return;}}
  else if(c==='"')string();else{while(offset<text.length&&!/[\s,}\]]/.test(text[offset]))offset++;}
 }
 scan(0);space();if(offset!==text.length)fail();return value;
}
module.exports={parseStrictJSON};
