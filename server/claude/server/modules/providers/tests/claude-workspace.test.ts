import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {transcriptEntries} from '../services/claude-statistics.service.js';

test('local usage counts a streamed assistant once and excludes tool-result and sidechain rows',()=>{
  const base={type:'assistant',sessionId:'s',timestamp:'2026-09-20T01:00:00Z'};
  const result=transcriptEntries([
    {...base,uuid:'1',message:{id:'msg1',model:'actual-model',usage:{input_tokens:100,output_tokens:5}}},
    {...base,uuid:'2',message:{id:'msg1',model:'actual-model',usage:{input_tokens:100,output_tokens:12}}},
    {...base,isSidechain:true,uuid:'3',message:{id:'msg2',model:'actual-model',usage:{input_tokens:900}}},
    {...base,type:'user',uuid:'4',message:{content:[{type:'tool_result'}]}},
    {...base,type:'user',uuid:'5',message:{content:'hello'}},
  ]);
  assert.equal(result.length,2);assert.deepEqual(result[0].models['actual-model'],{input:100,output:12,cacheRead:0,cacheWrite:0});
});

test('real instruction files preserve content, reject stale revisions and never overwrite symlink targets',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'claude-workspace-check-'));
  const before=process.env.CLAUDE_CONFIG_DIR;process.env.CLAUDE_CONFIG_DIR=dir;
  try{
    const {readClaudeInstructions,writeClaudeInstructions,completeClaudeModels}=await import('../services/claude-workspace.service.js');
    const native = [{value:'opus',resolvedModel:'claude-opus-5',displayName:'Opus',description:'Opus 5'}, {value:'legacy',resolvedModel:'claude-opus-4-8[1m]',displayName:'Opus 4.8',description:'Opus 4.8',supportsEffort:true,supportedEffortLevels:['high'] as ['high']}];
    const models = completeClaudeModels(native);
    assert.deepEqual(models.filter(m=>m.menuGroup==='more').map(m=>m.resolvedModel).sort(), ['claude-fable-5','claude-opus-4-8[1m]','claude-opus-4-7','claude-opus-4-6','claude-sonnet-4-6'].sort());
    assert.equal(models.length,6);
    assert.equal(models.find(m=>m.value==='legacy')?.supportsEffort,true);
    assert.equal('menuGroup' in native[1],false,'must not mutate the native catalog');
    assert.deepEqual(completeClaudeModels(models),models,'catalog completion must not add duplicate models');
    const effortModel={...native[0],supportsEffort:true,supportedEffortLevels:['low','high','xhigh','max']};
    const enhanced=completeClaudeModels([effortModel]);
    assert.deepEqual(enhanced[0].supportedEffortLevels,['low','high','xhigh','max','ultracode']);
    assert.deepEqual(completeClaudeModels(enhanced),enhanced,'Ultracode is not duplicated');
    const file=path.join(dir,'CLAUDE.md');await fs.writeFile(file,'existing instructions\n');
    const first=await readClaudeInstructions('user');assert.equal(first.content,'existing instructions\n');
    await fs.writeFile(file,'external edit\n');
    await assert.rejects(writeClaudeInstructions('user',undefined,'stale overwrite',first.revision),/其他程序修改/);
    const latest=await readClaudeInstructions('user');await writeClaudeInstructions('user',undefined,latest.content+'new rule\n',latest.revision);
    assert.equal(await fs.readFile(file,'utf8'),'external edit\nnew rule\n');
    const target=path.join(dir,'original.md');await fs.rename(file,target);await fs.symlink(target,file);
    const linked=await readClaudeInstructions('user');await assert.rejects(writeClaudeInstructions('user',undefined,'bad',linked.revision),/符号链接/);
    assert.equal(await fs.readFile(target,'utf8'),'external edit\nnew rule\n');
  }finally{if(before===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=before;await fs.rm(dir,{recursive:true,force:true});}
});
