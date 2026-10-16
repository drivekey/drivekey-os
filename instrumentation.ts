export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  const {initializePrivateRules}=await import('./core/rules-bootstrap');
  await initializePrivateRules();
 }
}
