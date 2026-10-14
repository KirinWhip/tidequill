# 许可证审计（LICENSE AUDIT）— Tidequill 潮笺 v1.0.0

## 结论
**Tidequill 是独立实现，未复制或改编 chatboxai/chatbox（GPL-3.0）的任何代码、图标或文案。** 因此本项目采用 **MIT 许可证**（见 `LICENSE`），无需履行 GPL-3.0 义务。

## 审计方法与证据
1. **开发记录**：项目从 v0.1.0 起由本仓库作者在本机从零编写（Electron + React + TypeScript + Vite）。开发过程中从未下载、打开或参考 chatboxai/chatbox 的源码；本次审计是第一次克隆其仓库，仅用于比对。仓库历史共 4 个提交，作者均为 `追逐 <KirinWhip@users.noreply.github.com>`。
1b. **功能来源**：功能清单参考了同类桌面 AI 客户端（包括 Chatbox）公开的功能描述；功能思路本身不受著作权保护，实现代码与界面均为独立编写。
2. **关键字检索**：在 `src/ electron/ tests/ e2e/ scripts/` 中检索 `chatboxai`、`GPL`、`General Public License`、`Copyright`、原作者名，结果为 0。
3. **代码相似度比对**（`scripts/similarity-audit.py`，对照 chatboxai/chatbox 2026-09-24 的 HEAD `0ac6385`，1854 个文件）：
   - 本项目 2616 行长度 ≥ 40 字符（去空白后）的代码中，与对方完全相同的有 7 行，全部是通用样板：`import { useEffect, useRef, useState } from 'react'` 这类 React / electron-updater import、`const listRef = useRef<HTMLDivElement>(null)`、`headers: { 'Content-Type': 'application/json' }`。
   - 连续 3 行完全相同的片段只有 1 处：`import fs/os/path from 'node:*'`，同样是样板代码。
   - 图片素材：没有任何一个文件与对方仓库中的图片逐字节相同。
4. **品牌与素材**：
   - v1.0.0 起应用改名为 Tidequill 潮笺，图标是全新绘制的 SVG（`build/icon.svg`，羽毛笔 + 潮汐），旧名称已从界面、安装包、托盘和 i18n 中全部移除。
   - 有一个单元测试确保发行源码中不再出现旧名称（`tests/p3.test.ts`）。仅保留两处兼容逻辑，使用 `LEGACY_*` 常量明确标注：识别旧版备份文件格式、首次启动时迁移旧版数据目录。
   - 之前的 0.x 版本使用通用的“蓝色聊天气泡”图标，同样是自行生成的，不是 Chatbox 的图标。

## 第三方依赖（实际打包进应用的 npm 包）
清单由 `scripts/gen-notices.mjs` 自动生成，依据是 Vite 打包记录的渲染进程模块和 esbuild metafile 中主进程 / 预加载脚本的输入，共 175 个包，未包含任何 GPL / LGPL / AGPL 许可的包。完整许可证文本见 `THIRD_PARTY_NOTICES.txt`，安装后位于 `resources/THIRD_PARTY_NOTICES.txt`，“关于”页面中也可查看。

| 许可证 | 数量 | 包 |
|---|---|---|
| MIT | 137 | @braintree/sanitize-url@7.1.2, @iconify/utils@3.1.7, @mermaid-js/parser@1.2.1, @modelcontextprotocol/sdk@1.32.1, @upsetjs/venn.js@2.0.0, ajv@8.20.0, ajv-formats@3.0.1, bail@2.0.2, builder-util-runtime@9.7.0, ccount@2.0.1, comma-separated-tokens@2.0.3, content-type@1.0.5 … |
| ISC | 26 | @ungap/structured-clone@1.4.0, d3-array@3.2.4, d3-axis@3.0.0, d3-color@3.1.0, d3-dispatch@3.0.1, d3-format@3.1.2, d3-hierarchy@3.1.2, d3-interpolate@3.0.1, d3-path@3.1.0, d3-scale@4.0.2, d3-scale-chromatic@3.1.0, d3-selection@3.0.0 … |
| BSD-3-Clause | 8 | d3-array@2.12.1, d3-ease@3.0.1, d3-path@1.0.9, d3-sankey@0.12.3, d3-shape@1.3.7, fast-uri@3.1.8, highlight.js@11.12.0, highlight.js@11.11.2 |
| (MPL-2.0 OR Apache-2.0) | 1 | dompurify@3.4.17 |
| BSD-2-Clause | 1 | mammoth@1.13.0 |
| Apache-2.0 | 1 | pdfjs-dist@4.10.38 |
| BlueOak-1.0.0 | 1 | sax@1.6.1 |

说明：
- DOMPurify 为 MPL-2.0 OR Apache-2.0 双许可，本项目按 Apache-2.0 使用。
- sax 为 BlueOak-1.0.0（宽松许可）。
- Electron（MIT）与 Chromium 的许可证由 electron-builder 随程序附带（`LICENSE.electron.txt`、`LICENSES.chromium.html`）。
- 开发与测试依赖（Playwright、Vitest、electron-builder、webdav-server 等）不随应用分发，不在上表中。
