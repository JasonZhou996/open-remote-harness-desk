import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {documentPage,previewDocument} from '../server/gateway/document-preview.js';
import {resolveLocalFile} from '../server/gateway/file-service.js';
import {localDownloadUrl} from '../web/codex/rendering.js';

const root=mkdtempSync(join(tmpdir(),'codex-document-check-')),caches=new Set();
const python=process.env.PREVIEW_TEST_PYTHON||'python3';
try{
  execFileSync(python,['-c',`
from docx import Document
from pptx import Presentation
from pptx.util import Inches
import sys, os
root=sys.argv[1]
doc=Document()
doc.add_heading('文档预览 / Document preview',0)
doc.add_paragraph('Page one: readable text, original layout.')
doc.add_page_break()
doc.add_heading('第二页 / Second page',0)
doc.add_paragraph('The complete document remains available to download.')
doc.save(os.path.join(root,'文档.docx'))
ppt=Presentation()
for title in ['第一页 / First slide', '第二页 / Second slide']:
    slide=ppt.slides.add_slide(ppt.slide_layouts[6])
    box=slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2))
    box.text=title
ppt.save(os.path.join(root,'演示.pptx'))
`,root]);
  const convert=(format,name)=>execFileSync('/usr/bin/libreoffice',[
    `-env:UserInstallation=${pathToFileURL(join(root,'profile')).href}`,'--headless','--convert-to',format,'--outdir',root,join(root,name),
  ],{timeout:60000,stdio:'pipe'});
  convert('doc','文档.docx');convert('ppt','演示.pptx');
  const word=await previewDocument({path:join(root,'文档.docx')});caches.add(word.directory);
  copyFileSync(word.pdf,join(root,'阅读.pdf'));
  for(const name of ['文档.docx','文档.doc','演示.pptx','演示.ppt','阅读.pdf']){
    const file=resolveLocalFile(join(root,name),{allowedRoots:[root]});
    const document=await previewDocument(file);caches.add(document.directory);
    assert.equal(document.pages,2,name);
    const page=await documentPage(file,2),before=statSync(page.path).mtimeMs;
    assert.equal(readFileSync(page.path).subarray(0,2).toString('hex'),'ffd8',name);
    execFileSync(python,['-c',`from PIL import Image,ImageChops
import sys
im=Image.open(sys.argv[1]).convert('RGB')
assert max(im.size)==1600
assert ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox()
`,page.path]);
    assert.equal((await documentPage(file,2)).path,page.path);
    assert.equal(statSync(page.path).mtimeMs,before,'Cached page must not render again');
    await assert.rejects(()=>documentPage(file,3));
    if(process.env.PREVIEW_TEST_URL){
      const base=process.env.PREVIEW_TEST_URL;
      const response=await fetch(`${base}/api/files/preview?${new URLSearchParams({path:file.path})}`);
      assert.equal(response.status,200);const data=await response.json();
      assert.equal(data.kind,'document');assert.equal(data.pages,2);
      const url=`${base}/api/files/document-page?${new URLSearchParams({path:file.path,page:'2',v:data.version})}`;
      const image=await fetch(url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');
      assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0,2).toString('hex'),'ffd8');
      assert.equal((await fetch(url,{headers:{'If-None-Match':image.headers.get('etag')}})).status,304);
    }
    console.log(`PASS: ${name}, two pages, nonblank JPEG, cache reuse${process.env.PREVIEW_TEST_URL?', HTTP preview and 304':''}`);
  }
  const broken=join(root,'broken.pdf');writeFileSync(broken,'not a PDF');
  await assert.rejects(()=>previewDocument({path:broken}));

  const dom=new JSDOM('<div id="filePanelBody"></div><a id="fileDownload"></a><span id="filePanelPath"></span><button id="filePanelBack"></button>',{url:'http://example.test',runScripts:'outside-only'});
  const {window}=dom,source=readFileSync(new URL('../web/codex/app.js',import.meta.url),'utf8');
  window.fileViewRequest=0;window.showFilesPanel=()=>{};window.$=selector=>window.document.querySelector(selector);window.localDownloadUrl=localDownloadUrl;
  window.fetch=async()=>({ok:true,json:async()=>({kind:'document',path:'/tmp/a.doc',filename:'a.doc',pages:2,version:word.version,width:word.width,height:word.height})});
  window.eval(source.slice(source.indexOf('async function openFilePreview('),source.indexOf('function openUtilityPanel(')));
  await window.openFilePreview('/tmp/a.doc','/tmp');
  assert.equal(window.document.querySelectorAll('.file-preview-document img').length,2);
  assert.equal(window.document.querySelectorAll('img')[1].loading,'lazy');
  assert.equal(window.document.querySelectorAll('img')[0].closest('button').dataset.imageSrc.includes('page=1'),true);
  assert.equal(window.document.querySelector('#fileDownload').download,'a.doc');
  dom.window.close();console.log('PASS: side-panel page rendering, lazy loading, enlarge action and original download');
}finally{rmSync(root,{recursive:true,force:true});for(const directory of caches)rmSync(directory,{recursive:true,force:true})}
