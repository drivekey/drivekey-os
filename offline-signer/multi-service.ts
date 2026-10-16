// Guarded offline USB operations only. Separate filenames preserve every v2 vault/file.
import { z } from "zod";
import {multiTransferOfflineAction} from './multi-transfer-service';
import {isLifecycleAction,lifecycleOfflineAction} from './lifecycle-service';
export {MULTI_FILES} from './multi-files';
const password=z.string().max(256);
const commands=z.discriminatedUnion("action",[
 z.object({scope:z.literal("multi"),action:z.literal("status")}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("review")}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("export-public")}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("create"),password,confirmation:password,consent:z.literal(true)}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("upgrade"),password,consent:z.literal(true)}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("check"),password}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("backup"),password}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("check-backup"),password}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("restore"),password,consent:z.literal(true)}).strict(),
 z.object({scope:z.literal("multi"),action:z.literal("sign"),password,fingerprint:z.string().regex(/^0x[0-9a-f]{64}$/),consent:z.literal(true)}).strict(),
]);
export async function multiOfflineAction(input:unknown,directory:string){
 const c=commands.parse(input);
 if(isLifecycleAction(c))return lifecycleOfflineAction(c,directory);
 if(c.action!=='review'&&c.action!=='sign')throw Error('Unsupported multichain operation.');
 return multiTransferOfflineAction(c,directory);
}
