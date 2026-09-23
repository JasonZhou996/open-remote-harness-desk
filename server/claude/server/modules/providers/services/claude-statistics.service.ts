import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import os from 'node:os';
import path from 'node:path';

type Usage={input:number;output:number;cacheRead:number;cacheWrite:number};
type Entry={at:number;session:string;messages:number;models:Record<string,Usage>};
const cache=new Map<string,{signature:string;entries:Entry[]}>();
let pending:Promise<Entry[]>|undefined;
const empty=():Usage=>({input:0,output:0,cacheRead:0,cacheWrite:0});
/** Collapse repeated streamed snapshots of one provider message before adding token counts. */
export function transcriptEntries(rows:Iterable<any>):Entry[] {
  const entries=new Map<string,Entry>();
  for(const row of rows){
    if(row.isSidechain || !['user','assistant'].includes(row.type) || !row.message)continue;
    if(row.type==='user' && Array.isArray(row.message.content) && row.message.content.every((x:any)=>x.type==='tool_result'))continue;
    const at=Date.parse(row.timestamp);if(!Number.isFinite(at))continue;
    const key=`${row.sessionId}:${row.message.id || row.uuid}`;
    if(!row.message.id&&!row.uuid)continue;
    const previous=entries.get(key);
    const entry:Entry={at,session:row.sessionId || '',messages:1,models:previous?.models || {}};
    const usage=row.message.usage;
    if(usage && row.message.model && row.message.model!=='<synthetic>'){
      const old=entry.models[row.message.model] || empty();
      entry.models[row.message.model]={input:Math.max(old.input,Number(usage.input_tokens)||0),output:Math.max(old.output,Number(usage.output_tokens)||0),cacheRead:Math.max(old.cacheRead,Number(usage.cache_read_input_tokens)||0),cacheWrite:Math.max(old.cacheWrite,Number(usage.cache_creation_input_tokens)||0)};
    }
    entries.set(key,entry);
  }
  return [...entries.values()];
}
async function readEntries(){
  const root=path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(),'.claude'),'projects');
  const dirs=await fs.readdir(root,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const seen=new Set<string>();const result:Entry[]=[];
  for(const dir of dirs.filter(d=>d.isDirectory())){
    for(const name of await fs.readdir(path.join(root,dir.name))){
      if(!name.endsWith('.jsonl'))continue;
      const file=path.join(root,dir.name,name);const stat=await fs.lstat(file);if(!stat.isFile())continue;
      seen.add(file);const signature=`${stat.size}:${stat.mtimeMs}`;let item=cache.get(file);
      if(!item||item.signature!==signature){
        // ponytail: changed transcripts are scanned once; switch to byte cursors if they become very large.
        const rows:any[]=[];const input=createReadStream(file);const lines=createInterface({input,crlfDelay:Infinity});
        try{for await(const line of lines){try{const r=JSON.parse(line);rows.push({type:r.type,isSidechain:r.isSidechain,sessionId:r.sessionId,uuid:r.uuid,timestamp:r.timestamp,message:r.message?{id:r.message.id,model:r.message.model,usage:r.message.usage,content:Array.isArray(r.message.content)?r.message.content.map((c:any)=>({type:c.type})):undefined}:undefined});}catch{/* partial last line */}}}finally{lines.close();input.destroy();}
        item={signature,entries:transcriptEntries(rows)};cache.set(file,item);
      }
      result.push(...item.entries);
    }
  }
  for(const file of cache.keys())if(!seen.has(file))cache.delete(file);
  return result;
}
export async function claudeStatistics(days:number){
  if(!pending)pending=readEntries().finally(()=>{pending=undefined;});
  const all=await pending;const cutoff=days?Date.now()-days*86400000:0;
  const models:Record<string,Usage>={};const daily:Record<string,number>={};const sessions=new Set<string>();let messages=0;
  for(const entry of all){if(entry.at<cutoff)continue;sessions.add(entry.session);messages+=entry.messages;const day=new Date(entry.at).toISOString().slice(0,10);daily[day]=(daily[day]||0)+entry.messages;for(const [name,u] of Object.entries(entry.models)){const target=models[name] ||= empty();for(const k of Object.keys(target) as (keyof Usage)[])target[k]+=u[k];}}
  return {sessions:sessions.size,messages,activeDays:Object.keys(daily).length,models,daily,source:'本机 Claude Code 主会话记录；UTC 日期；不含子代理记录',updatedAt:new Date().toISOString()};
}
