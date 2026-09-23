import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../web/claude/package.json',import.meta.url));
const {code}=await require('esbuild').transform(await readFile(new URL('../web/claude/src/services/artifactParser.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {extractArtifactsAndThinking:parse,cleanStreamingChatText:clean}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const fence=(language,code)=>'```'+language+'\n'+code+'\n```';

test('artifacts extract renderable blocks without consuming ordinary code or surrounding prose',()=>{
  const ordinary=fence('python','\n'.repeat(8)+'print("hello")')+'\n'+fence('diff','-old\n+new')+'\n'+fence('javascript','export default 42;');
  assert.equal(parse(ordinary,'m').cleanedText,ordinary);
  assert.equal(clean(ordinary).cleanText,ordinary);
  const html=fence('html','<button>你好</button>'),svg=fence('svg','<svg><circle r="3"/></svg>'),react=fence('tsx','export default function App(){return <h1>Hello</h1>}');
  const input=['之前',html,'之间',ordinary,svg,react,'之后'].join('\n');
  const result=parse(input,'m');
  assert.deepEqual(result.artifacts.map(a=>a.type),['text/html','image/svg+xml','application/vnd.ant.react']);
  assert.ok(result.cleanedText.includes(ordinary));
  assert.ok(result.cleanedText.startsWith('之前')&&result.cleanedText.endsWith('之后'));
  assert.equal(new Set(result.artifacts.map(a=>a.id)).size,3);
  assert.deepEqual(parse(input,'m').artifacts.map(a=>a.id),result.artifacts.map(a=>a.id));
  assert.ok(clean(input).cleanText.includes(ordinary)&&clean(input).cleanText.endsWith('之后'));
});

test('explicit artifacts coexist with fences; incomplete blocks and quoted examples are not lost',()=>{
  const explicit='<antArtifact identifier="demo" type="text/html" title="示例"><h1>显式</h1></antArtifact>';
  const result=parse('<thinking>思考</thinking>\n'+explicit+'\n'+fence('html','<p>第二个</p>'),'m');
  assert.equal(result.thinkingContent,'思考');assert.equal(result.artifacts.length,2);
  assert.equal(result.artifacts[0].title,'示例');
  const unfinished='前文\n```html\n<h1>尚未完成';
  assert.equal(parse(unfinished,'m').cleanedText,unfinished);
  assert.equal(clean(unfinished).cleanText,'前文');
  assert.equal(clean(unfinished).isCrafting,true);
  const quoted=fence('text',explicit);
  assert.equal(parse(quoted,'m').cleanedText,quoted);assert.equal(parse(quoted,'m').artifacts.length,0);
  assert.equal(parse('<antArtifact title="未完成">内容','m').artifacts.length,0);
  const explanation='只认 `<antArtifact>` 标签。\n'+fence('html','<p>实际预览</p>');
  assert.equal(parse(explanation,'m').artifacts.length,1,'inline tag documentation must not consume the following artifact');
  assert.ok(parse(explanation,'m').cleanedText.includes('`<antArtifact>`'));
});
