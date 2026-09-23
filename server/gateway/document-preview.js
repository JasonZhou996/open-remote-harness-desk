import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, renameSync, statSync} from 'node:fs';
import {basename, extname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const run=promisify(execFile), pending=new Map();
export const isPreviewDocument=path=>/\.(pdf|docx?|pptx?)$/i.test(path);
const command=(name,args)=>run(name,args,{timeout:60000,maxBuffer:1024*1024,env:{...process.env,LC_ALL:'C'}});
function once(key,work){
  if(!pending.has(key))pending.set(key,Promise.resolve().then(work).finally(()=>pending.delete(key)));
  return pending.get(key);
}

export async function previewDocument(file){
  if(!isPreviewDocument(file.path))throw new Error('此文件不支持文档预览');
  const stat=statSync(file.path);
  const version=createHash('sha256').update(`${file.path}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`).digest('hex');
  return once(version,async()=>{
    const directory=join(tmpdir(),'codex-webui-document-previews',version);
    mkdirSync(directory,{recursive:true,mode:0o700});
    let pdf=file.path;
    if(extname(file.path).toLowerCase()!=='.pdf'){
      pdf=join(directory,basename(file.path,extname(file.path))+'.pdf');
      if(!existsSync(pdf)){
        await command('/usr/bin/libreoffice',[
          `-env:UserInstallation=${pathToFileURL(join(directory,'profile')).href}`,
          '--headless','--nologo','--nodefault','--nofirststartwizard','--norestore',
          '--convert-to','pdf','--outdir',directory,file.path,
        ]);
        if(!existsSync(pdf))throw new Error('文档转换失败，请确认文件未加密且可以正常打开');
      }
    }
    const {stdout}=await command('/usr/bin/pdfinfo',[pdf]);
    const pages=Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    if(!Number.isInteger(pages)||pages<1)throw new Error('无法读取文档页数');
    const size=stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+)/m);
    return {pdf,directory,version,pages,width:Number(size?.[1]||595),height:Number(size?.[2]||842)};
  });
}

export async function documentPage(file,page){
  if(!Number.isSafeInteger(page)||page<1)throw new Error('无效页码');
  const document=await previewDocument(file);
  if(page>document.pages)throw new Error('页码超出文档范围');
  const prefix=join(document.directory,`page-${page}`),path=prefix+'.jpg';
  await once(path,async()=>{
    if(existsSync(path))return;
    await command('/usr/bin/pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','1600',
      '-jpeg','-jpegopt','quality=85,optimize=y',document.pdf,prefix+'.rendering']);
    renameSync(prefix+'.rendering.jpg',path);
  });
  return {path,version:document.version};
}
