export class HusherSessionExpiredError extends Error {
 constructor(){super('Your owner session ended. Sign in again, then check your saved order before continuing.');this.name='HusherSessionExpiredError';}
}
export async function husherClientAction(action:string,input:unknown={}){
 const authentication=['login','history','logout'].includes(action);
 const signal=AbortSignal.timeout(authentication?15000:60000);
 try{
  const response=await fetch('/api/providers/husher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input}),cache:'no-store',signal});
  const data=await response.json();
  if(!response.ok&&(data.code==='HUSHER_SESSION_REQUIRED'||data.error==='Sign in as the Husher integration owner.'))throw new HusherSessionExpiredError();
  if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Husher action stopped.');
  return data;
 }catch(error){
  if(signal.aborted)throw Error(authentication
   ?'Husher did not respond within 15 seconds. Check your owner session before trying to sign in again.'
   :'Husher did not respond within 60 seconds. An order or submission may still have completed. Reconcile saved history before creating or sending again.');
  if(error instanceof SyntaxError)throw Error('Husher returned an unreadable response. Check your session or saved history before retrying.');
  throw error;
 }
}
