# Third-party notices

## Source provenance and component licenses

| Component | Source | Retained license |
| --- | --- | --- |
| Codex WebUI foundation (`server/gateway`, `server/codex`, `web/codex`) | `lezi-fun/codex-webui` | Root LICENSE, MIT, copyright 2026 lezi-fun |
| Claude service (`server/claude`) | `siteboon/claudecodeui` (CloudCLI), local import baseline `9f9eb16` | AGPL-3.0-or-later; full LICENSE and NOTICE remain in the component |
| Claude web (`web/claude`) | Existing local `claude-ui-clone` repository, import baseline `309c65f` | No standalone license was present in the imported tree; this reorganization does not grant or change redistribution rights |
| Android client and product integration | Maintained in this project | Third-party libraries retain their own licenses |

Only the used modules are kept in the working tree. This repository starts from the trimmed project snapshot without prior Git history; upstream attribution and component license notices are retained. The root MIT license does not relicense the AGPL component, unlicensed imported material, brand assets, or external applications. Codex, Claude Code and ZCode executables are installed separately and are not redistributed in this repository.

Android uses AndroidX WebKit 1.5.0 (Apache-2.0), restored from Google's Maven repository by its build script; the JAR is not tracked. npm packages are installed from each component's lockfile and keep their package licenses.

Claude's existing Lora and JetBrains Mono Google Fonts faces are served locally from `web/claude/src/assets/fonts` to avoid external startup requests. Their SIL Open Font License notices are retained in that directory's `OFL.txt`. KaTeX styles and fonts are built from the existing npm dependency.

Cross-harness session import invokes [inmzhang/transession](https://github.com/inmzhang/transession) 0.2.0 (MIT), installed separately using Cargo. Its source tree and compiled executable are not copied into this repository.


## Lucide

The interface icons in `web/codex/codex-icons.js` use the exact Lucide icon path data bundled with the locally installed Codex.app (`lucide-react` 0.456.0).

ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Source verification: `/Applications/Codex.app/Contents/Resources/THIRD_PARTY_NOTICES.txt`, entry `lucide-react (0.456.0)`.

## Codex.app visual assets

`web/codex/codex-brand.js` retains the monochrome Knot path extracted from the installed Codex.app wordmark, while `web/codex/assets/codex-app-icon*.png` and `web/codex/assets/codex-motion/*.json` were extracted from the same local application to reproduce its brand and tool-motion presentation. These assets are distributed separately from the MIT-licensed source code and remain subject to the rights and terms of their respective owner. They may be removed or replaced if requested by the relevant rights holder.

OpenAI, Codex, and related marks are trademarks of their respective owners. This project is not affiliated with or endorsed by OpenAI.
