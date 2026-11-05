import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const dir=process.argv[2];if(!dir)throw Error('Provide a NEW local directory outside the deliverable/repository.');
const target=path.resolve(dir);await mkdir(target,{recursive:false});
const password=randomBytes(32).toString('hex'),admin=randomBytes(32).toString('hex'),webhook=randomBytes(32).toString('hex');
for(const [name,value]of Object.entries({db_password:password,admin_token:admin,webhook_secret:webhook,database_url:'postgresql://drivekey:'+password+'@db:5432/drivekey'}))await writeFile(path.join(target,name),value+'\n',{flag:'wx',mode:0o600});
console.log('Local secret files created. Restrict directory access, back them up privately, and mount them as Docker secrets. No secret values were printed.');
