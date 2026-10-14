# ChatBox Clone — 桌面 AI 聊天客户端

一个类似 [Chatbox AI](https://chatboxai.app) 的跨平台桌面 AI 聊天客户端，基于 **Electron + React + TypeScript + Vite**。界面语言默认跟随系统（中文系统显示简体中文，其他显示 English），可在 设置 → 通用 中手动切换。

| 浅色 · 中文 | 深色 · 中文 |
|---|---|
| ![](screenshots/p0/light-zh.png) | ![](screenshots/p0/dark-zh.png) |
| **浅色 · English** | **深色 · English** |
| ![](screenshots/p0/light-en.png) | ![](screenshots/p0/dark-en.png) |

## 功能

- **多模型提供方**：OpenAI 及任意 OpenAI 兼容接口（DeepSeek、xAI Grok、通义千问等，已预置）、Anthropic Claude、Google Gemini、Ollama（本地）。在设置中填写 API 密钥 / API 地址，可一键「获取模型」列表；每个对话可单独选择提供方与模型。
- **对话**：流式输出、停止生成、重新生成、编辑后重发、复制、删除单条消息。
- **渲染**：Markdown（GFM 表格等）、代码高亮（含一键复制）、LaTeX 公式（KaTeX，支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`）、Mermaid 流程图。
- **多会话管理**：侧边栏、搜索（标题与内容）、重命名、删除、置顶；本地持久化；导出单个对话为 Markdown，导出全部为 JSON，导入 JSON / Markdown。
- **系统提示词 / 角色（Persona）**：每个对话可编辑系统提示词（顶部 🧠 按钮）；角色库可新建/编辑并一键以该角色开启新对话。
- **提示词库**：可增删改，输入框旁 📚 按钮快速插入。
- **图片输入**：粘贴、拖拽或上传图片，发送给视觉模型（OpenAI/Claude/Gemini/Ollama 格式均已适配）。
- **图片生成**：调用 OpenAI Images API（dall-e-3、gpt-image-1 等，也可用于兼容接口），生成结果保存到图库，可放大查看、下载、删除。
- **文件附件**：PDF（pdf.js）、DOCX（mammoth）、TXT/MD/CSV/JSON 及各类代码文件，提取文本后放入上下文。
- **插件 / 工具**：
  - **MCP 服务器**：支持 stdio 与 HTTP（Streamable HTTP，自动回退 SSE），其工具以 function calling 方式提供给模型（OpenAI 兼容、Claude、Gemini 均支持），自动多轮调用（最多 8 轮），工具调用过程可展开查看。
  - **简易插件 API**：在插件目录（插件/工具 → 打开插件目录）放入 CommonJS `.js` 文件即可：
    ```js
    module.exports = {
      name: 'weather',
      description: '查询天气',
      tools: [{
        name: 'get_weather',
        description: 'Get weather of a city',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        execute: async ({ city }) => `${city}：晴，25°C`,
      }],
    }
    ```
    内置插件：`get_current_time`、`calculator`。
- **设置**：温度、最大输出 Token、上下文消息数、请求超时、浅色/深色/跟随系统主题、字号、HTTP/SOCKS 代理、发送键（Enter 或 Ctrl+Enter）。
- **快捷键**：`Ctrl+N` 新建对话，`Ctrl+K` 搜索，`Ctrl+,` 设置，`Esc` 关闭弹窗，`F12` 开发者工具。

数据保存在 `%APPDATA%\ChatBox Clone\data\*.json`（Windows），插件在 `%APPDATA%\ChatBox Clone\plugins`。

## 安全设计

- 渲染进程：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；拒绝所有权限请求；禁止页面跳转到外部地址。
- **所有模型 API 请求经主进程转发**（IPC 流式回传，`electron/http.ts`），渲染进程 CSP 为 `connect-src 'self'`，无法直接访问网络。
- 生产构建注入严格 CSP（`script-src 'self'`，见 `vite.config.ts`）。
- API 密钥用 Electron `safeStorage` 加密存储（Windows DPAPI / macOS 钥匙串 / Linux libsecret），旧版明文密钥在首次读取时自动迁移为密文。Linux 上若没有 keyring 服务则无法加密，设置页会显示警告。
- Markdown 不渲染原始 HTML，链接只允许 http(s)/mailto；Mermaid 使用 `securityLevel: 'strict'`，输出的 SVG 再经 DOMPurify 清洗。
- MCP / 插件工具调用前弹出原生确认框，显示工具名和 JSON 参数，可“允许 / 拒绝”，可勾选“始终允许此工具”（可在 插件/工具 页撤销）。
- 注意：插件运行在主进程中，拥有完整本机权限，请只安装可信插件。

## 开发运行

需要 Node.js 20+。

```bash
npm install
npm run dev        # 启动 Vite 开发服务器 + Electron（热更新）
```

其他命令：

```bash
npm test           # 单元测试（vitest）：提供方适配器、存储、密钥加密、i18n 硬编码检查、主进程 HTTP 桥 + 模拟服务器、插件/MCP
node tests/mock-server.mjs 18080   # 启动模拟 OpenAI 兼容服务器（模型名 mock-ok / mock-401 / mock-429 / mock-timeout / mock-disconnect / mock-tool）
npm run build      # 类型检查 + 打包渲染进程(dist/) + 主进程(dist-electron/)
npm start          # 运行已构建版本
```

## 端到端测试（Playwright）

E2E 测试直接驱动**打包后的应用**（`release/*-unpacked`）：

```bash
npm run pack:linux-dir && ./scripts/e2e-linux.sh   # Linux（Xvfb + gnome-keyring）
npm run dist:win && npx playwright test            # Windows
```

覆盖：启动与安全配置、明文密钥迁移、新建对话 + 流式回复、401 / 429 / 超时 / 中途断开 / 网络不可达的本地化错误提示、主题与语言切换（含重启后保持）、JSON/Markdown 导出与导入、工具调用确认（拒绝 / 始终允许）、四种主题×语言截图。报告输出到 `playwright-report/index.html`，截图在 `screenshots/p0/`。

## 持续集成

`.github/workflows/ci.yml`：在 `windows-latest` 上执行单元测试 → 构建 NSIS 安装包和便携版 → 对打包后的 exe 运行 Playwright E2E → 上传报告、截图和安装包；推送 `v*` 标签时自动创建 GitHub Release 并附带安装包。

## 打包

```bash
npm run dist:win     # Windows：NSIS 安装包 + 便携版 exe，输出到 release/
npm run dist:linux   # Linux AppImage
```

在 Windows 上直接运行 `npm run dist:win` 即可。在 Linux 上交叉打包 Windows 需要安装 wine（`sudo apt install wine`）。

产物（release/ 目录）：
- `ChatBox Clone-Setup-0.2.0-x64.exe` — 安装程序（可选择安装目录，中文界面）
- `ChatBox Clone-0.2.0-portable.exe` — 便携版，免安装

> 安装包未签名，首次运行时 Windows SmartScreen 可能提示「未知发布者」，点「更多信息 → 仍要运行」即可。

## 项目结构

```
electron/main.ts      主进程：窗口、存储（密钥加密）、代理、文件对话框、HTTP 桥、工具确认
electron/http.ts      主进程 HTTP 桥（超时/断线/网络错误分类）
electron/secrets.ts   safeStorage 加密与迁移
electron/tools.ts     MCP 客户端（stdio/HTTP）与插件加载器
electron/preload.ts   安全桥接 API (window.api)
src/shared/           与界面无关的逻辑：提供方适配器（请求构造/流式解析）、存储、导入导出
src/renderer/         React 界面：App、Markdown 渲染、设置/角色/提示词/图片/插件面板、i18n
tests/                单元测试与模拟服务器
e2e/                  Playwright E2E
src/renderer/locales/ 语言包（zh-CN、en）
```

## 说明 / 已知限制

- 详见 `docs/self-audit.md`（功能自查与已知问题）。
- 安装包未签名，无应用图标。
- DeepSeek reasoner 等模型的“思考过程”字段暂不显示。
