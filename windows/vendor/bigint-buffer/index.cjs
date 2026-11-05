'use strict';
// Reject overflow instead of silently truncating. All consumers use unsigned values.
function toBigIntBE(buf){if(!Buffer.isBuffer(buf)||buf.length>1024)throw Error('Invalid bigint buffer.');return buf.length?BigInt('0x'+buf.toString('hex')):0n;}
function toBigIntLE(buf){return toBigIntBE(Buffer.from(buf).reverse());}
function toBufferBE(value,width){if(typeof value!=='bigint'||value<0n||!Number.isSafeInteger(width)||width<0||width>1024||value>=(1n<<BigInt(width*8)))throw Error('Unsigned bigint width overflow.');return width===0?Buffer.alloc(0):Buffer.from(value.toString(16).padStart(width*2,'0'),'hex');}
function toBufferLE(value,width){return toBufferBE(value,width).reverse();}
module.exports={toBigIntBE,toBigIntLE,toBufferBE,toBufferLE};
