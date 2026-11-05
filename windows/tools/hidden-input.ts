import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';

/** A single terminal session: readline handles editing/paste, while ALL echo is discarded. */
export function createHiddenTerminal(input:NodeJS.ReadStream=process.stdin,output:NodeJS.WriteStream=process.stdout){
 if(!input.isTTY||!output.isTTY)throw Error('interactive-terminal-required');
 const muted=new Writable({write(_chunk,_encoding,done){done();}});
 Object.assign(muted,{isTTY:true,columns:output.columns||80});
 const rl=createInterface({input,output:muted,terminal:true,historySize:0,history:[],prompt:''});
 let pending:((error:Error)=>void)|undefined,closed=false;
 const cancel=()=>{pending?.(Error('input-cancelled'));pending=undefined;rl.close();};
 rl.on('SIGINT',cancel);rl.on('close',()=>{closed=true;pending?.(Error('input-cancelled'));pending=undefined;input.pause();});
 return {
  async read(prompt:string):Promise<string>{
   if(closed||pending)throw Error('input-unavailable');output.write(prompt);
   return new Promise((resolve,reject)=>{pending=reject;rl.question('',value=>{pending=undefined;output.write('\n');if(value.length>1024)reject(Error('input-too-long'));else if(/[\u0000-\u001f\u007f]/.test(value))reject(Error('input-control'));else resolve(value);});});
  },
  close(){pending?.(Error('input-cancelled'));pending=undefined;rl.close();muted.end();input.pause();}
 };
}
