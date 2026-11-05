// Fixed destinations only. No keys, vault files, addresses or passphrases leave
// this process when a user opens a website workflow.
const updates=Object.freeze([
 {id:'workflow',title:'The interface and signing roadmap',date:'29 Oct 2026',isoDate:'2026-10-29T23:26:37Z',summary:'Plans for simpler setup, wallet management and transaction review.',thumbnail:'assets/blue/illustration-handoff-1200.png',url:'https://x.com/DriveKeyyy/status/2115948449107525758'},
 {id:'roadmap',title:'USB release & wallet roadmap',date:'29 Oct 2026',isoDate:'2026-10-29T21:17:33Z',summary:'An October roadmap for the USB release, local signing and privacy tools.',thumbnail:'assets/usb-pcb-detail.png',url:'https://x.com/DriveKeyyy/status/2115915967306035454'},
 {id:'hardware',title:'Hardware manufacturing update',date:'28 Oct 2026',isoDate:'2026-10-28T13:14:54Z',summary:'Manufacturing plans for the metal enclosure and preinstalled software.',thumbnail:'assets/usb-pcb-hero.png',url:'https://x.com/DriveKeyyy/status/2115432116410634344'}
]);
const providers=Object.freeze({lifi:'LI.FI',jupiter:'Jupiter',direct:'Uniswap',husher:'Husher'});
function resolveWebRoute(route,option){
 switch(route){
  case 'send':return {url:'https://drivekey.info/app/send',hint:'Prepare the transfer in DriveKey.'};
  case 'swap':if(!Object.hasOwn(providers,option))throw Error('Choose a supported swap route.');return {url:'https://drivekey.info/app/swap?provider='+option,hint:providers[option]+' opened in DriveKey.'};
  case 'hinkal-pay':return {url:'https://drivekey.info/app/hinkal',hint:'In Hinkal, select Private payment.'};
  case 'hinkal-swap':return {url:'https://drivekey.info/app/hinkal',hint:'In Hinkal, select Swap.'};
  case 'hinkal-deposit':return {url:'https://drivekey.info/app/hinkal',hint:'In Hinkal, select Receive, then Deposit ETH.'};
  case 'savings':if(!['standard','strong'].includes(option))throw Error('Choose Standard or Strong.');return {url:'https://drivekey.info/app/savings',hint:'Choose '+(option==='strong'?'Strong':'Standard')+' in Savings to configure it.'};
  case 'article':{const post=updates.find(p=>p.id===option);if(!post)throw Error('Unknown update.');return {url:post.url,hint:'Opening the original DriveKey post.'};}
  case 'market-data':if(option!=='coingecko')throw Error('Unknown market data source.');return {url:'https://www.coingecko.com',hint:'Opening the market data source.'};
  default:throw Error('Unsupported website action.');
 }
}
module.exports={updates,resolveWebRoute};
