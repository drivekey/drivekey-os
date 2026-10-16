import {open} from 'node:fs/promises';
import {validateCrashPattern} from './sandbox-process';
async function boundedKernelText(path:string,max:number){const f=await open(path,'r');try{const b=Buffer.alloc(max+1),r=await f.read(b,0,b.length,0);if(r.bytesRead>max)throw Error('CLI core policy rejected.');return b.subarray(0,r.bytesRead).toString('utf8');}finally{await f.close();}}
export async function assertCliSecretPolicy(){
 try{
  if(process.platform!=='linux')throw Error('unsupported');
  const limits=await boundedKernelText('/proc/self/limits',8192);
  if(!/^Max core file size[ \t]+0[ \t]+0[ \t]+bytes[ \t]*$/m.test(limits))throw Error('core');
  validateCrashPattern(await boundedKernelText('/proc/sys/kernel/core_pattern',256));
 }catch{throw Error('CLI core policy rejected.');}
}
export function readCliLine(question:string,secret:boolean,maxCharacters:number):Promise<string>{
 const input=process.stdin,output=process.stdout;
 if(!input.isTTY||!output.isTTY||typeof input.setRawMode!=='function')return Promise.reject(Error('Interactive terminal required.'));
 if(input.readableEncoding!=null)return Promise.reject(Error('Terminal input rejected.'));
 if(!Number.isInteger(maxCharacters)||maxCharacters<1||maxCharacters>256||question.length>256)return Promise.reject(Error('Terminal input rejected.'));
 return new Promise((resolve,reject)=>{
  let value='',done=false;const wasRaw=!!input.isRaw,decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const timer=setTimeout(()=>finish(Error('Terminal input timed out.')),120000);
  const finish=(error?:Error)=>{
   if(done)return;done=true;clearTimeout(timer);input.off('data',receive);input.off('end',ended);input.off('error',failed);
   try{input.setRawMode(wasRaw);input.pause();output.write('\n');}catch{error=Error('Terminal input rejected.');}
   const result=value;value='';if(error)reject(error);else resolve(result);
  };
  const ended=()=>finish(Error('Terminal input rejected.')),failed=()=>finish(Error('Terminal input rejected.'));
  const receive=(chunk:string|Buffer)=>{
   let text:string;
   try{
    const bytes=typeof chunk==='string'?Buffer.from(chunk,'utf8'):chunk;
    if(bytes.length>1024||(typeof chunk==='string'&&bytes.toString('utf8')!==chunk))throw Error('encoding');
    text=decoder.decode(bytes,{stream:true});
   }catch{return finish(Error('Terminal input rejected.'));}
   for(let i=0;i<text.length;){const code=text.codePointAt(i)!;const char=String.fromCodePoint(code);i+=char.length;
    if(char==='\u0003')return finish(Error('Cancelled.'));
    if(char==='\r'||char==='\n'){
     if(i<text.length&&text.slice(i)!=='\n')return finish(Error('Terminal input rejected.'));
     return finish();
    }
    if(char==='\b'||char==='\u007f'){if(value){value=Array.from(value).slice(0,-1).join('');if(!secret)output.write('\b \b');}continue;}
    if(/\p{Cc}/u.test(char)||(!secret&&/\p{Cf}/u.test(char))||value.length+char.length>maxCharacters)return finish(Error('Terminal input rejected.'));
    value+=char;if(!secret)output.write(char);
   }
  };
  try{
   // Discard pending type-ahead before each fresh approval or password prompt.
   input.pause();let discarded=0;for(let pending=input.read();pending!==null;pending=input.read()){discarded+=Buffer.byteLength(pending);if(discarded>4096)throw Error('Terminal input rejected.');}input.setRawMode(true);
   input.on('data',receive);input.once('end',ended);input.once('error',failed);output.write(question);input.resume();
  }catch{finish(Error('Terminal input rejected.'));}
 });
}
