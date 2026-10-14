<p align="center"><img src="build/icons/128x128.png" width="96" alt="Tidequill"></p>

# 潮笺 Tidequill

简体中文 | [English](README.en.md) · [更新日志](CHANGELOG.md)

## 简介

**潮笺（Tidequill）** 是一个独立开发、以 MIT 许可开源的跨平台桌面 AI 聊天客户端，基于 **Electron + React + TypeScript + Vite**。界面语言默认跟随系统（中文系统显示简体中文，其他系统显示 English），也可以在 设置 → 通用 中手动切换。

| 浅色 · 中文 | 深色 · 中文 |
|---|---|
| ![](screenshots/r2-A/light-zh.png) | ![](screenshots/r2-A/dark-zh.png) |
| **浅色 · English** | **深色 · English** |
| ![](screenshots/r2-A/light-en.png) | ![](screenshots/r2-A/dark-en.png) |

## 功能

- **多模型提供方**：OpenAI 及任意 OpenAI 兼容接口（DeepSeek、xAI Grok、通义千问等已预置）、Anthropic Claude、Google Gemini、Ollama（本地，可自动检测）。可以一键获取模型列表，每个对话单独选择提供方和模型。
- **对话**：
  - 流式输出、停止生成、重新生成、编辑后重发（旧版本保留为分支，可切换）、分支到新对话。
  - 引用回复、删除单条消息、朗读。
  - 首次回复后自动总结一个不超过 10 个字的标题（可关闭，手动改名后不会覆盖）。
- **深度思考**：按各家官方文档发送参数（详见下方“深度思考参数”），思考过程以可折叠块显示。
- **渲染**：
  - Markdown（GFM），单个换行即显示为换行。
  - 代码高亮，支持复制、行号和折叠。
  - KaTeX 公式；Mermaid 图表，可放大、复制源码、下载 SVG。
- **会话管理**：
  - 文件夹、标签、置顶、重命名、右键菜单。
  - 全文搜索（显示命中片段）、多选批量删除。
  - 每个对话可单独设置系统提示词、温度、Top P、最大输出 Token、上下文消息数。
- **用量与费用**：每条消息和整个对话的 Token 合计及估算费用，价格表可编辑。没有价格的模型显示“未配置价格”，点击可直接添加。
- **请求透明**：对话设置 → “查看本次请求内容”，显示最近一次请求实际发送的系统提示词、工具定义、消息（大小和 token 估算）以及完整 JSON（密钥不显示）。默认不附带任何系统提示词，也不附带工具定义。
- **附件与图片**：
  - 支持 PDF、DOCX、TXT/MD/CSV/JSON 和各类代码文件（提取文本放入上下文）。
  - 图片可以粘贴、拖拽或上传，发送给视觉模型。
  - 图片生成使用 OpenAI Images API。
  - **不支持** Excel / PPT 文件；也**没有**内置联网搜索，需要的话可以通过 MCP 或插件接入。
- **插件 / MCP**：
  - MCP 服务器支持 stdio 和 HTTP（Streamable HTTP，自动回退到 SSE）。
  - 简易插件 API 见下方“使用”一节。
  - 每次工具调用前都会弹出确认。
- **数据**：
  - 本地 JSON 存储，API 密钥用系统加密保存（safeStorage）。
  - 完整备份 / 恢复；导出 Markdown / JSON / PDF；可选 WebDAV 同步。
- **系统**：全局快捷键 `Ctrl+Shift+Space`、系统托盘、开机启动、通过 GitHub Releases 检查更新。

## 安装

在 [Releases](https://github.com/KirinWhip/tidequill/releases/latest) 下载 Windows 安装版（`Tidequill-Setup-<版本>-x64.exe`）或便携版（`Tidequill-<版本>-portable.exe`），以及 `SHA256SUMS.txt`。

### 为什么安装包没有签名？
Windows 代码签名证书需要每年向证书机构（CA）付费（OV 证书每年数百至上千元，EV 证书更贵），还要完成个人或企业的身份验证；SmartScreen 的信誉也需要积累下载量才能建立。本项目是个人开源项目，目前没有购买证书，所以 exe **未签名**。首次运行时 Windows SmartScreen 会弹出“Windows 已保护你的电脑”。这是对所有未签名或新发布程序的通用提示，不代表程序有问题。你可以按下文的方法校验 SHA256，确认文件和 GitHub Release 中发布的一致，也可以自行从源码构建。

### 安装版步骤
1. 打开 [Releases](https://github.com/KirinWhip/tidequill/releases/latest)，下载 `Tidequill-Setup-1.0.0-x64.exe` 和 `SHA256SUMS.txt`。
2. （推荐）校验 SHA256，方法见下文。
3. 双击安装包。如果出现蓝色窗口“Windows 已保护你的电脑”：
   1. 点击窗口中的 **“更多信息”**；
   2. 确认“应用”一栏是 `Tidequill-Setup-1.0.0-x64.exe`、“发布者”一栏是“未知发布者”；
   3. 点击 **“仍要运行”**。
4. 安装向导中可选择“为所有用户 / 仅为我”安装以及安装目录，然后点击“安装”。
5. 完成后从开始菜单或桌面快捷方式“Tidequill”启动。首次启动会显示引导页：选择提供方 → 填写 API 密钥 → 点击“测试连接”→“开始使用”。
6. 卸载：设置 → 应用 → Tidequill → 卸载。聊天数据保留在 `%APPDATA%\Tidequill`，如需彻底清除，请手动删除该目录。

### 便携版
- 下载 `Tidequill-1.0.0-portable.exe`，放到任意目录（U 盘也可以），双击即可运行，无需安装。首次运行同样可能出现 SmartScreen 提示，处理方式同上（更多信息 → 仍要运行）。
- 便携版启动时会先把程序解压到临时目录，所以启动比安装版稍慢；聊天数据同样保存在 `%APPDATA%\Tidequill`。
- 便携版不支持自动更新，需要手动下载新版本替换。

### 校验 SHA256
每个 Release 都附带 `SHA256SUMS.txt`，发布说明中也列出了各文件的哈希值。在下载目录打开 PowerShell：
```powershell
Get-FileHash .\Tidequill-Setup-1.0.0-x64.exe -Algorithm SHA256
Get-FileHash .\Tidequill-1.0.0-portable.exe -Algorithm SHA256
# 自动比对：
Get-Content .\SHA256SUMS.txt | ForEach-Object {
  $h, $f = $_ -split '\s+\*?', 2
  if (Test-Path $f) { '{0}  {1}' -f $f, ((Get-FileHash $f -Algorithm SHA256).Hash -eq $h.ToUpper()) }
}
```
输出的 `Hash` 与 `SHA256SUMS.txt` 中对应行一致（不区分大小写），或自动比对结果为 `True`，即表示文件完整、未被篡改。

### 数据位置
数据保存在 `%APPDATA%\Tidequill\data\*.json`，插件在 `%APPDATA%\Tidequill\plugins`。从 0.x 版本升级时，首次启动会自动复制旧数据（旧目录保留不删）。

## 使用

1. 首次启动会显示引导页：选择提供方 → 填写 API 密钥 → 点击“测试连接” → “开始使用”。
2. 顶部选择提供方和模型。点“深度思考”开启推理，点齿轮进入对话设置（参数、文件夹、标签、查看请求内容）。
3. 快捷键：`Ctrl+N` 新建对话，`Ctrl+K` 搜索，`Ctrl+,` 设置，`Esc` 关闭弹窗。

### 为什么输入 Token 比我输入的字多？
每次请求除了你的消息外，还可能带上：系统提示词（默认没有）、工具定义（默认不发送；启用插件 / MCP 后才会发送，每个工具都会占用 token）、上下文中的历史消息，以及提供方自己的消息格式开销。可以在 对话设置 → “查看本次请求内容” 中查看具体发送了什么。

### 深度思考参数
| 提供方 | 开启 | 关闭 | 思考内容字段 | 官方文档 |
|---|---|---|---|---|
| DeepSeek（api.deepseek.com） | `thinking: {type: "enabled"}`、`reasoning_effort: "high"` | `thinking: {type: "disabled"}`（官方默认开启，所以显式关闭） | `reasoning_content` | [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) |
| OpenAI o 系列 / gpt-5 等 | `reasoning_effort: "high"` | 不发送 | 本客户端使用 Chat Completions，未实现 Responses API 的推理摘要，所以 OpenAI 官方模型的思考内容不显示 | [Reasoning](https://developers.openai.com/api/docs/guides/reasoning) |
| Claude 4.6+ / 5.x | `thinking: {type: "adaptive", display: "summarized"}` | 不发送 | `thinking_delta` | [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) |
| Claude 4.5 及更早 | `thinking: {type: "enabled", budget_tokens}`（≥1024 且小于 max_tokens） | 不发送 | `thinking_delta` | [Extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) |
| Gemini 3 | `thinkingConfig: {includeThoughts: true, thinkingLevel: "high"}` | 不发送 | `thought: true` 的 part | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| Gemini 2.5 | `thinkingConfig: {includeThoughts: true, thinkingBudget: -1}` | 不发送 | 同上 | 同上 |
| Ollama（/v1） | `reasoning_effort: "high"` | `reasoning_effort: "none"` | `reasoning` | [OpenAI 兼容](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx) |

第三方平台托管的 DeepSeek 模型不会附加额外参数，因为各平台的参数不同。

### 插件
在 插件/工具 → 打开插件目录 中放入 CommonJS `.js` 文件即可：
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
内置的演示工具 `get_current_time`、`calculator` 默认不发送给模型，可在 设置 → 对话 中开启。插件运行在主进程中，拥有完整的本机权限，请只安装可信插件。

## 开发

需要 Node.js 20 及以上。

```bash
npm install
npm run dev                 # Vite + Electron 热更新
npm test                    # 单元测试（vitest）
npm run build               # 类型检查 + 构建渲染进程和主进程 + 生成第三方声明
npm run pack:linux-dir && ./scripts/e2e-linux.sh   # Linux E2E（Xvfb + gnome-keyring）
npm run dist:win && npx playwright test            # Windows 打包 + E2E
node tests/mock-server.mjs 18080                   # 本地模拟 OpenAI 兼容服务器
```

- CI（`.github/workflows/ci.yml`）在 `windows-latest` 上依次执行：单元测试 → 打包 → 对打包后的 exe 运行 E2E → 上传 Playwright HTML 报告和截图。推送 `v*` 标签时会创建 Release 并附带 `SHA256SUMS.txt`。
- 安全设计：渲染进程开启 sandbox 和 contextIsolation，CSP 为 `connect-src 'self'`，所有网络请求都经主进程转发；Markdown 不渲染原始 HTML；Mermaid 使用 strict 模式并经过 DOMPurify 清洗。
- 目录：`electron/`（主进程、HTTP 桥、密钥、MCP/插件）、`src/shared/`（提供方适配器、存储、用量）、`src/renderer/`（界面、语言包）、`tests/`、`e2e/`。
- 功能自查和已知限制见 [`docs/self-audit-round2.md`](docs/self-audit-round2.md)。

## 许可证

- 本项目以 **MIT** 许可发布（见 `LICENSE`）。它是独立实现，没有复用任何 GPL 项目（包括 chatboxai/chatbox）的代码或素材，审计过程见 [`docs/LICENSE-AUDIT.md`](docs/LICENSE-AUDIT.md)。
- 第三方组件及其许可证见 [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt)，应用内“关于”页面也可以查看。
