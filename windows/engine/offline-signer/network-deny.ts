// Load before any cryptographic dependency in the dedicated offline workers.
const deny=()=>{throw Error('Networking is disabled in the offline worker.');};
globalThis.fetch=deny;
for(const [name,methods]of [['node:http',['request','get']],['node:https',['request','get']],['node:http2',['connect']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dgram',['createSocket']],['node:dns',['lookup','resolve','resolve4','resolve6']]] as const){const module=require(name);for(const method of methods)module[method]=deny;}
require('node:net').Socket.prototype.connect=deny;
for(const method of ['lookup','resolve','resolve4','resolve6'])require('node:dns').promises[method]=deny;
if('WebSocket' in globalThis)(globalThis as any).WebSocket=class{constructor(){deny();}};
