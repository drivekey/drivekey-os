export async function readBoundedPipe(input:AsyncIterable<Uint8Array>,limit:number){
 const chunks:Buffer[]=[];let total=0;
 for await(const chunk of input){total+=chunk.length;if(total>limit)throw Error('Input exceeds boundary limit.');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
