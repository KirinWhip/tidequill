# 自查报告（P0 轮之前的 v0.1.0 状态）

> 评估时间：2026-10-14。标记含义：
> - ✅ **已完成且测过**：有自动化测试或在真实运行中验证过
> - 🟡 **已实现但未真实测试**：代码存在、可编译，但没有对真实服务/真实交互进行验证
> - 🟠 **占位或部分**：只做了一部分，或有明显缺陷
> - ❌ **未做**
>
> v0.1.0 时**没有使用任何真实 API 密钥**，也**没有在 Windows 上运行过**安装包。所谓“测过”只指单元测试（mock fetch）和 Linux Xvfb 下的截图。

## 1. 模型提供方

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| OpenAI / 兼容接口请求构造 | ✅（仅单元） | `src/shared/providers.ts` `buildOpenAIRequest`；`tests/providers.test.ts` “openai” |
| Anthropic 请求构造与流式解析 | ✅（仅单元） | `tests/providers.test.ts` “anthropic”“anthropic events” |
| Gemini 请求构造与流式解析 | ✅（仅单元） | `tests/providers.test.ts` “gemini”“gemini chunks” |
| Ollama（走 /v1 兼容接口） | ✅（仅单元） | `tests/providers.test.ts` “ollama uses /v1”“lists ollama models” |
| 对真实 OpenAI/Claude/Gemini/DeepSeek/Grok/Qwen 服务调用 | 🟡 | 从未用真实密钥测试 |
| 获取模型列表按钮 | 🟡 | `Panels.tsx` SettingsPanel；仅 Ollama 解析有单元测试 |
| 每会话模型选择 | 🟡 | `App.tsx` ChatView 头部；截图中可见，未交互测试 |

## 2. 对话

| 功能 | 状态 | 证据 / 说明 |
|---|---|---|
| 流式输出 | 🟡 | 解析逻辑有单元测试；应用内从未对任何服务端（含 mock）跑通过 |
| 停止 / 重新生成 / 编辑重发 / 复制 / 删除 | 🟡 | `App.tsx` `runModel/regenerate/editResend`；无测试 |
| 错误显示 | 🟠 | 只显示原始 `HTTP 401: ...` 英文文本，无友好、无本地化；无超时处理 |
| Markdown / 代码高亮 / LaTeX / Mermaid | ✅（目测） | `components/Markdown.tsx`；`screenshots/01-chat-light-zh.png` 中真实渲染 |
| 代码块前多一行空行 | 🟠 | 截图可见的小瑕疵 |

## 3. 会话管理

| 功能 | 状态 | 证据 |
|---|---|---|
| 存储层增删改、置顶排序、搜索 | ✅（仅单元） | `tests/storage.test.ts` |
| 侧边栏 UI、重命名、删除、置顶 | 🟡 | 截图可见，未交互测试 |
| 导出 Markdown / JSON、导入 | 🟠 | 往返有单元测试；UI 上的文件对话框流程未测试 |
| 本地持久化（主进程 JSON 文件） | ✅（目测） | `electron/main.ts` `kv:get/kv:set`；截图用的就是写入的 JSON |

## 4. 角色 / 提示词库 / 图片 / 附件

| 功能 | 状态 | 证据 |
|---|---|---|
| 系统提示词、角色库、提示词库 | 🟡 | `Panels.tsx` ListEditor；未测试 |
| 图片输入（粘贴/拖拽/上传） | 🟡 | 请求格式有单元测试；UI 交互未测试 |
| 图片生成 + 图库 | 🟡 | `providers.ts generateImage`、`ImagesPanel`；未测试 |
| PDF/DOCX/文本提取 | 🟡 | `src/renderer/files.ts`；未用真实文件测试 |

## 5. 插件 / 工具

| 功能 | 状态 | 证据 |
|---|---|---|
| 插件加载与调用 | ✅ | `tests/tools.test.ts` |
| MCP stdio | ✅ | `tests/tools.test.ts` 连接真实 stdio MCP 服务 `tests/fixtures-mcp-server.mjs` |
| MCP HTTP（Streamable/SSE） | 🟡 | `electron/tools.ts`；未测试 |
| 模型 ↔ 工具多轮调用 | 🟡 | `App.tsx runModel`；未端到端测试 |
| 工具调用确认 | ❌ | 模型可以不经确认直接调用任意工具（包括可执行命令的 MCP 服务） |

## 6. 设置与界面

| 功能 | 状态 | 证据 |
|---|---|---|
| 温度/最大 Token/上下文/字号/发送键 | 🟡 | `SettingsPanel`；未测试 |
| 浅色/深色主题 | ✅（目测） | `screenshots/04-chat-dark-en.png` |
| 代理 | 🟡 | `session.setProxy`；未测试 |
| 快捷键 | 🟡 | 未测试 |
| 中英文切换 | 🟠 | 存在硬编码字符串（“OpenAI / 兼容接口”“Plugins”“Prompt”“DevTools”、默认角色/提示词、导出 Markdown 中的“模型/附件”、主进程工具错误等）；默认语言固定中文，不跟随系统；无检查 |

## 7. 打包与测试

| 项目 | 状态 | 证据 |
|---|---|---|
| Windows NSIS 安装包 + 便携版 | 🟠 | 在 Linux + wine 下构建成功（`release/`），**从未在 Windows 上安装运行** |
| 单元测试 | ✅ | 20 个全部通过（providers 11、storage 7、tools 2） |
| E2E 测试 | ❌ | 无 |
| CI | ❌ | 无 |
| 应用图标、代码签名 | ❌ | 默认 Electron 图标；未签名 |

## 8. 已知安全问题（v0.1.0）

1. **`webSecurity: false`**：为绕过 CORS 关闭了同源策略，渲染进程可以访问任意来源，且一旦出现 XSS 后果更严重。
2. **API 密钥明文存储**：`%APPDATA%/ChatBox Clone/data/settings.json` 中明文保存。
3. **没有 CSP**。
4. **未启用 sandbox**（虽然 `contextIsolation: true`、`nodeIntegration` 默认 false）。
5. **Mermaid SVG 通过 `dangerouslySetInnerHTML` 输出，未经 DOMPurify 清洗**（虽然 securityLevel 为 strict）。
6. **工具调用无需用户确认**：模型（或提示注入）可直接触发 MCP/插件工具。
7. **`kv:set` 接受任意键名**（键名虽已过滤路径字符）。
8. 插件以完整 Node 权限在主进程中运行（插件机制本身的性质，需在文档中提示）。
9. 计算器插件使用 `Function()` 求值（有字符白名单限制）。

---

# P0 后状态（v0.2.0）

## 本轮测试结果（Linux 盒子上实际运行）

- 单元测试 `npm test`：**6 个文件 / 41 个用例全部通过**（providers 11、storage 7、secrets 5、i18n 6、bridge 10、tools 2）。
- E2E `./scripts/e2e-linux.sh`（Playwright `_electron`，驱动打包后的 `release/linux-unpacked/chatbox-clone`，Xvfb + gnome-keyring）：**14 / 14 通过**。报告：`playwright-report/index.html`。
- Windows：安装包/便携版在 Linux + wine 下构建成功；**Windows 上的 E2E 只在 CI 工作流中定义，尚未运行**（取决于 GitHub 推送）。

## 状态变化

| 项目 | 现状态 | 证据 |
|---|---|---|
| 应用内流式对话（对 mock 服务器） | ✅ | E2E “new conversation, streamed reply”（验证中途有部分文本、停止按钮出现、最终完整） |
| 友好的本地化错误：401/429/超时/中途断开/网络不可达 | ✅ | `tests/bridge.test.ts`（含 500）；E2E 5 个错误用例（中文 4 个 + 英文网络不可达） |
| 中途断开时保留已收到的部分回复 | ✅ | bridge 测试 + E2E disconnected 用例 |
| 停止生成 | ✅（单元） | bridge 测试 “user abort stops quietly”；E2E 未点击停止按钮 |
| 主题切换并持久化 | ✅ | E2E “switch theme and language”（重启后仍为深色/英文） |
| 导出 JSON / Markdown、导入 JSON | ✅ | E2E “export JSON and import it back”（原生文件对话框被 stub） |
| 工具调用确认（拒绝/允许/始终允许） | ✅ | E2E “tool calls require confirmation”（原生 `dialog.showMessageBox` 被 stub，验证了内容和逻辑，未验证原生对话框外观） |
| i18n：语言包 + 跟随系统 + 手动覆盖 | ✅ | `src/renderer/locales/`；`tests/i18n.test.ts`（键一致、无 CJK、无硬编码英文 JSX 文本/属性/alert、使用的键都存在、`resolveLang`） |
| 密钥加密 + 明文迁移 | ✅ | `tests/secrets.test.ts`；E2E 第 1 个用例在真实 libsecret 下验证磁盘上已无明文、出现 `enc:v1:` |
| contextIsolation / nodeIntegration / sandbox / webSecurity | ✅ | E2E 第 1 个用例读取 `getLastWebPreferences()` |
| CSP | ✅ | E2E 检查 meta 存在、渲染进程直接 `fetch` 被拦截、截图过程中无 CSP 报错 |
| Markdown XSS（原始 HTML 不渲染）、Mermaid SVG 经 DOMPurify | ✅ | E2E 截图用例中注入 `<img onerror>`，验证未渲染、标题未被修改；Mermaid 标签文字仍可见 |
| 获取模型列表经主进程 | ✅（单元） | bridge 测试 “list models” |
| 真实厂商 API（OpenAI/Claude/Gemini/DeepSeek/…） | 🟡 | 仍从未用真实密钥测试 |
| 图片生成、文件附件解析、MCP HTTP、代理、角色/提示词库 UI | 🟡 | 仍未测试 |
| Windows 上运行 | 🟡 | 待 CI |

## 仍存在的安全问题 / 限制（如实列出）

1. **渲染进程内存中仍持有解密后的密钥**：设置页需要编辑密钥，请求头也由渲染进程组装后交给主进程。磁盘上已加密，但若渲染进程被攻破，仍可读到密钥。更彻底的做法是密钥只留在主进程、由主进程注入请求头（未做）。
2. **HTTP 桥接受任意 http(s) URL**：渲染进程被攻破时可借主进程访问任意地址（包括内网）。已限制协议，未做域名白名单。
3. CSP 中 `style-src 'unsafe-inline'`（KaTeX/Mermaid 需要），`img-src` 允许 `https:`（远程生成图片）。
4. **Linux 上 safeStorage 依赖 keyring 服务**；没有时密钥仍为明文（设置页显示警告）。Windows 使用 DPAPI，应始终可用（CI 中会断言）。
5. Linux E2E 使用 `--no-sandbox` 启动（容器中没有 setuid chrome-sandbox）；`webPreferences.sandbox` 仍为 true。Windows 上不加此参数。
6. 插件以完整 Node 权限运行于主进程；工具确认只能约束“模型发起的调用”，不能约束插件代码本身。
7. 计算器插件仍用 `Function()` 求值（字符白名单）。
8. i18n 检查基于正则，可能漏掉用字符串拼接产生的文案；返回给模型的工具错误信息（如 `Tool not found`）是英文，属于模型侧文本，不显示为 UI 文案（只出现在可展开的工具调用详情里）。
9. 安装包未签名、无图标。

# P1 后状态（v0.3.0，界面重做）

## 测试结果（Linux 盒子上实际运行）
- 单元测试：7 个文件 / 94 个用例全部通过（新增 contrast 47、reasoning 5、无 emoji 检查 1）。
- E2E：21 / 21 通过（新增 7 个：停止按钮、模型搜索/自定义模型、深度思考、悬停操作、代码复制/表格/Mermaid 工具栏、行号/折叠、输入工具栏附件）。

## 本轮发现并修复的 P0 遗留问题
- **复制功能自 P0 起实际不可用**：P0 拒绝了所有权限请求，导致 `navigator.clipboard.writeText` 静默失败；P0 的 E2E 没有检查剪贴板所以没发现。现改为经主进程 `clipboard` 写入，E2E 读取系统剪贴板验证。

## 部分完成 / 未真实验证
| 项目 | 状态 | 说明 |
|---|---|---|
| 深度思考 | 🟡 | 请求参数有单元测试；对 mock 的 `reasoning_content` 有 E2E；对真实 OpenAI o 系列 / Claude / Gemini / Ollama 未验证。`reasoning_effort` 发给不支持的模型可能报 400；Claude 开启 thinking 时多轮工具调用未回传 thinking 签名块，可能被拒绝。Ollama 的 `think` 参数在 /v1 兼容接口上是否生效未验证 |
| 朗读 | 🟡 | 只验证按钮存在与 `speechSynthesis` 可用；未验证真实发声（Linux 容器无语音引擎） |
| 模型列表自动获取 | ✅（mock） | 对 mock `/v1/models` 验证；真实厂商未验证 |
| “网页/工具”开关 | 🟠 | 只有“工具”开关（控制 function calling）；**没有内置联网搜索** |
| 对比度检查 | ✅ | 只检查令牌对；代码高亮主题（highlight.js github-dark）和 Mermaid 主题内部配色不在检查范围内 |
| 图片附件缩略图 | ✅ | E2E 用 1×1 PNG 验证 |
