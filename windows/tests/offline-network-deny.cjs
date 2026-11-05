// Test bootstrap: any attempted signer network I/O terminates before a request.
const deny=()=>{process.stderr.write('UNEXPECTED_SIGNER_NETWORK');process.exit(90);};
global.fetch=deny;
for(const [name,methods]of [['node:http',['request','get']],['node:https',['request','get']],['node:net',['connect','createConnection']],['node:tls',['connect']],['node:dns',['lookup','resolve']]]){const module=require(name);for(const method of methods)module[method]=deny;}
