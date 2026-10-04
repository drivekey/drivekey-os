// Provider response boundary. Never echo response bodies or retry provider requests.
export async function readJupiterResponse(response:Response):Promise<unknown>{
 if(!response.ok){
  await response.body?.cancel();
  throw Error(response.status===429?'Jupiter request limit reached. Wait before requesting a new quote; no transaction was prepared.':'Jupiter build unavailable.');
 }
 const reader=response.body?.getReader();if(!reader)throw Error('Missing Jupiter response.');
 const decoder=new TextDecoder();let text='',bytes=0;
 for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>250000){await reader.cancel();throw Error('Jupiter response too large.');}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();
 try{return JSON.parse(text);}catch{throw Error('Jupiter returned an invalid response. No transaction was prepared.');}
}
