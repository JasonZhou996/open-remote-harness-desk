// The pinned web build hides its desktop sidebar toggle and only exposes a
// narrow-screen navigation handle. Reuse its native toggle and React state.
export function adaptZcodeAsset(name, body) {
  if (name !== "index-BZagIv7p.js") return body;
  let source = body.toString("utf8");
  const replacements = [
    [
      't&&(0,$.jsx)(t1,{title:A,shortcut:u,ariaLabel:A,onClick:x,children:(0,$.jsx)(O,{className:`size-4`})})',
      '(t||!i)&&(0,$.jsx)(t1,{title:A,shortcut:u,ariaLabel:A,buttonClassName:!i?`max-md:hidden`:void 0,onClick:x,children:(0,$.jsx)(O,{className:`size-4`})})',
    ],
    // A collapsed wide sidebar must not hide the independent narrow navigation
    // when a folding screen crosses the existing 768px breakpoint.
    ['let Vn=ve,{panelRef:Hn', 'let Vn=$t&&bn||ve,{panelRef:Hn'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error("ZCode sidebar patch does not match the pinned asset");
    source = source.replace(before, after);
  }
  return Buffer.from(persistZcodeWorkspace(source));
}

export function persistZcodeWorkspace(source) {
  const before = 'zl=new Map;function Bl(e,t){return zl.delete(e),zl.set(e,t),t}';
  // ponytail: retain eight workspace views; inline text/diffs need their source contents to reopen.
  const after = `zl=new Map((()=>{try{return JSON.parse(localStorage.getItem('codex-webui-zcode-panels')||'[]')}catch{return []}})());function Bl(e,t){zl.delete(e);zl.set(e,t);try{localStorage.setItem('codex-webui-zcode-panels',JSON.stringify([...zl].slice(-8)))}catch{}return t}`;
  if (!source.includes(before)) throw new Error('ZCode workspace patch does not match the pinned asset');
  return source.replace(before, after);
}
