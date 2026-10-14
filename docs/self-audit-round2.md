# Round 2 自查报告（如实版）

- **范围**：一是 v1.0.0 时整个应用的真实状态，二是 Round 2 第 1–26 项各自的当前状态。
- **标记**：
  - ✅ **已完成**：已实现，并有自动化测试覆盖。
  - 🟡 **占位/部分**：有实现，但功能不完整或只是简化版。
  - ⚠️ **未验证**：已实现，但没有在真实环境中验证过，例如真实 API、真实 Windows 安装或重启。
  - ❌ **未做**：没有实现。
- **测试条件**：E2E 全部基于本地模拟服务器（tests/mock-server.mjs）。**本项目从未用真实的 OpenAI / Claude / Gemini / DeepSeek 密钥跑过自动化测试**，所有“提供方兼容性”结论都来自请求构造的单元测试和官方文档比对。

## 一、v1.0.0 整体状态

| 模块 | 状态 | 说明 |
|---|---|---|
| OpenAI 兼容请求构造与流式解析 | ✅ | 单元测试 + 模拟服务器 E2E。 |
| Claude / Gemini 适配 | ✅ 构造 / ⚠️ 真实接口 | 只有单元测试，没有真实调用过。 |
| Ollama 检测与模型列表 | ✅ | 用模拟的 /api/tags 测试。 |
| 深度思考 | 🟡 | v1.0.0 的问题：所有 OpenAI 兼容接口统一发送 reasoning_effort；Ollama 发送 `think` 在 /v1 上无效；DeepSeek 不发任何参数（而官方默认开启思考）；Claude 4.7+ 的 `enabled` 会返回 400。**已在阶段 A 修正**，见第二部分。 |
| 工具调用（内置、插件、MCP） | ✅ 模拟 / ⚠️ 真实 MCP | MCP stdio/HTTP 只用测试桩验证过。v1.0.0 **默认把 2 个内置演示工具发给每一次请求**，这是输入 token 偏高的主要原因（阶段 A 已改）。 |
| 默认系统提示词 | ✅ | v1.0.0 **没有任何默认系统提示词**，已抓包确认。 |
| Markdown / 代码 / KaTeX / Mermaid | ✅ | v1.0.0 中单个换行不会换行（阶段 A 已改）。 |
| 会话管理、文件夹、标签、搜索、分支 | ✅ | E2E 覆盖。 |
| 用量与费用 | 🟡 | v1.0.0 中没有价格的模型显示空白，用户以为是 bug（阶段 A 已改）。预置价格是手工录入的，会过时。 |
| 附件 | 🟡 | 支持 PDF、DOCX 和文本类文件；**不支持** xlsx、pptx、OCR。 |
| 联网搜索 | ❌ | 没有实现。 |
| 图片生成 | ⚠️ | 只用模拟接口测过。 |
| 备份 / 恢复 / WebDAV / PDF 导出 | ✅ | 用本地 WebDAV 服务器做过 E2E。 |
| 托盘、全局快捷键 | ✅ | E2E 覆盖（Linux）。 |
| 开机启动 | ⚠️ | 只调用了 setLoginItemSettings，没有做真实重启验证。 |
| 自动更新 | ⚠️ | 只验证到“发现新版本”（模拟更新源）。下载、安装和重启都没有在真实环境验证；仓库现已公开，真实的检查更新理论上可用，但同样没测过。 |
| 旧数据迁移（0.x → Tidequill） | ✅ Linux E2E / ⚠️ Windows | Windows CI 跳过了这个用例。 |
| 自动标题 | 🟡 | v1.0.0 只截取第一条消息的前 30 个字符（阶段 A 已改为模型总结）。 |
| 安全：sandbox、CSP、主进程转发、safeStorage | ✅ | 测试覆盖。 |
| 安全：F12 开发者工具 | 🟡 | 生产版也能按 F12 打开（第 20 项待做）。 |
| 安全：插件 | 🟡 | 插件直接在主进程 require，没有隔离（第 21 项待做）。 |
| 存储写入 | 🟡 | 主数据用 tmp + rename 原子写；没有自动备份轮换，也没有损坏检测（第 23 项待做）。 |
| 标题栏 | ❌ | 使用系统原生标题栏（第 8 项待做）。 |
| 仓库简介 | ❌ | 仍为 “Desktop AI chat client (Chatbox-like)…”（第 26 项待做）。 |

## 二、Round 2 各项当前状态（阶段 A 完成后）

### 阶段 A（本轮已做）
| # | 项目 | 状态 | 说明 / 未验证部分 |
|---|---|---|---|
| 1 | 未配置价格提示 + 跳转价格表 | ✅ | 标题栏下方显示“未配置价格”，消息底部显示“— 未配置价格”，点击打开 设置 → 用量 并提供“添加 <模型> 的价格”按钮。有 E2E。 |
| 2 | 输入 token 调查 + 默认不发工具 + 请求查看 | ✅ / ⚠️ | 抓包数据见第三部分。409 这个数字是用户在真实 DeepSeek 上看到的，本地只能估算。“工具定义加上服务端注入的函数调用模板是主要来源”是**推断**，没有用真实密钥复现。 |
| 3 | 不暗示不存在的功能 | ✅ / 🟡 | 已确认没有默认系统提示词，工具描述只有“获取当前时间”“计算表达式”，都没有提到联网或 Excel。所以那两句话是模型自己编的，客户端不能完全杜绝。已做的处理：默认不发工具；README 写明“不支持 Excel/PPT、没有联网搜索”。**没有**加“能力说明”系统提示词，因为它每次都会增加 token，与第 2 项冲突；如需要可在 B/C 阶段做成可选项。 |
| 4 | 单个换行显示为换行 | ✅ | 使用 remark-breaks。E2E 验证四行诗引用块中有 3 个 `<br>`。 |
| 5 | 深度思考参数按官方文档 | ✅ 构造 / ⚠️ 真实接口 | 文档链接和参数见第四部分。只有单元测试和模拟服务器验证，**没有用真实密钥调用任何一家**。Gemini generateContent 的 `thinkingLevel` 字段名没有在 REST 参考中逐字核对（抓取的页面被截断）。 |
| 6 | README 重构 + README.en.md + CHANGELOG.md | ✅ | 已删除“私有仓库”和“DeepSeek 思考过程暂不显示”两条说明。 |
| 7 | 自动标题 | ✅ | 设置里有开关；手动改名后设置 titleManual，不会被覆盖。E2E 覆盖了总结、关闭开关、手动改名三种情况。真实模型能否稳定给出 10 字以内的标题没有验证，客户端会裁剪到 10 个字。 |

### 阶段 B / C / D（尚未开始，全部 ❌）
| # | 项目 | 当前状态 |
|---|---|---|
| 8 | 自定义标题栏 | ❌ 原生标题栏 |
| 9 | 提供方设置页改版（模型标签、测试连接、已保存提示、状态徽标） | ❌（v1.0.0 已有“获取模型”和引导页里的测试连接，其余都没有） |
| 10 | 侧边栏底部精简 | ❌ |
| 11 | 右上角图标的提示（含快捷键）、空文件夹引导 | 🟡 已有 title 提示，但不含快捷键；没有空状态引导 |
| 12 | 阅读宽度、悬停显示按钮 | 🟡 已有悬停显示；没有阅读宽度设置 |
| 13 | 上下文用量指示 | ❌ |
| 14 | 联网搜索 | ❌ |
| 15 | xlsx / pptx / OCR / 超大文件提示 | ❌ |
| 16 | HTML / SVG 沙箱预览 | ❌ |
| 17 | 多模型并排 | ❌ |
| 18 | 对话内查找（Ctrl+F） | ❌ |
| 19 | 语音输入 | ❌ |
| 20 | 生产版禁用 F12，开发者模式 | ❌ |
| 21 | 插件放进 utilityProcess，SHA256 确认 | ❌ |
| 22 | MCP 命令行确认，按服务器 + 工具授权 | 🟡 已有按工具名“始终允许”和撤销；没有命令行确认，也没按服务器区分 |
| 23 | 原子写、备份轮换、损坏恢复、SQLite 评估 | 🟡 已原子写；其余没做 |
| 24 | 扫描仓库和历史中的密钥 / 路径 / 用户名 | ❌ 没有系统扫描过 |
| 25 | SECURITY.md、Dependabot、audit、CodeQL、Issue 模板 | ❌ |
| 26 | 仓库简介 | ❌ |

### 需要用户手动验证的项目（自动化无法覆盖）
1. **自动更新**（仓库已公开）：安装 v1.0.0，等 v1.0.1 发布后，在“关于”页点“检查更新”。应提示有新版本 → 下载 → 重启后版本号变为 1.0.1。
2. **开机启动**：设置 → 系统 → 勾选“开机启动”。重启 Windows 后应自动启动（如果开了托盘，会在托盘中）。
3. **旧数据迁移**：如果机器上有 0.x 版本的数据（`%APPDATA%\chatbox-clone`），首次启动 Tidequill 后对话应该都在，旧目录仍然保留。
4. **真实 DeepSeek 深度思考**（阶段 A 新增）：
   1. 用 `deepseek-flash` 开启“深度思考”提问，回复上方应出现“思考过程”。
   2. 关闭后再问，不应再出现思考过程。
   3. 两种情况都可以在“查看本次请求内容”中看到 `thinking` 字段。
5. **真实 token 对比**：用 `你好 你是谁 你能干啥?` 提问，比较 v1.0.0 和新版消息底部的输入 token。预期会明显下降，具体数字取决于服务商。

## 三、A2：“你好 你是谁 你能干啥?” 的请求实际内容

数据来自本地模拟服务器抓到的完整请求体。token 数用本应用的本地估算器计算，**不是**服务商的计费数。

| | v1.0.0（修复前） | 阶段 A（修复后，默认设置） |
|---|---|---|
| 系统提示词 | 0 字符（不发送） | 0 字符（不发送） |
| 工具定义 | 2 个（builtin__get_current_time、builtin__calculator），406 字节 JSON，约 102 token | **不发送**（0 字节） |
| 消息 | 1 条，约 10 token | 1 条，约 15 token（含每条消息的格式开销估算） |
| 整个请求体 | 584 字节 | 219 字节（DeepSeek 官方接口，含 `thinking: disabled`） |

用户看到 409 输入 token，原因分析如下（属于**推断**，没有用真实密钥复现）：
- 消息本身只有约 10–20 token。
- 主要来源是工具定义，以及服务商在带 `tools` 时注入的函数调用模板。这类模板通常有几百 token，各家实现不同，不公开。
- 修复后默认不再发送工具，只有用户启用插件或 MCP 工具时才会发送；内置演示工具需要在设置里手动开启。
- 现在可以在 对话设置 → “查看本次请求内容” 中看到每一部分的大小和完整 JSON。

## 四、A5：深度思考参数与依据的官方文档

| 提供方 | 依据 | 开启 | 关闭 | 思考内容 |
|---|---|---|---|---|
| DeepSeek 官方接口（baseURL 含 api.deepseek.com） | https://api-docs.deepseek.com/guides/thinking_mode ；https://api-docs.deepseek.com/quick_start/pricing | `thinking: {"type":"enabled"}` + `reasoning_effort: "high"` | `thinking: {"type":"disabled"}`（官方默认开启，所以必须显式关闭） | `delta.reasoning_content`；带工具的多轮对话会回传历史的 `reasoning_content`（文档说明缺少它会返回 400） |
| OpenAI（o 系列、gpt-5 等） | https://developers.openai.com/api/docs/guides/reasoning （原 platform.openai.com/docs/guides/reasoning） | Chat Completions 的 `reasoning_effort: "high"`（文档说明可选值随模型不同：none/minimal/low/medium/high/xhigh/max） | 不发送 | Chat Completions 不返回思考内容；Responses API 的推理摘要没有实现 |
| Claude Opus/Sonnet 4.6+、5.x、Mythos | https://platform.claude.com/docs/en/build-with-claude/thinking | `thinking: {"type":"adaptive","display":"summarized"}`，同时去掉 temperature 和 top_p | 不发送 | `thinking_delta` |
| Claude 4.5 及更早 | https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking | `thinking: {"type":"enabled","budget_tokens": max(1024, min(8192, max_tokens/2))}`，并保证 max_tokens > budget | 不发送 | `thinking_delta` |
| Gemini 3 | https://ai.google.dev/gemini-api/docs/thinking ；https://ai.google.dev/api/generate-content | `generationConfig.thinkingConfig: {includeThoughts: true, thinkingLevel: "high"}` | 不发送 | `parts[].thought == true` |
| Gemini 2.5 | 同上 | `thinkingConfig: {includeThoughts: true, thinkingBudget: -1}`（动态） | 不发送 | 同上 |
| Ollama（/v1 OpenAI 兼容） | https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx ；https://docs.ollama.com/capabilities/thinking | `reasoning_effort: "high"`（v1.0.0 发送的 `think: true` 在 /v1 上不被接受） | `reasoning_effort: "none"` | `delta.reasoning` |
| 第三方平台托管的 DeepSeek 模型 | — | 不加参数（各平台参数不同） | 不加参数 | 能解析 `reasoning_content` 或 `reasoning` |

已知限制：
- Claude 开启思考并调用工具时，官方要求把带签名的 thinking 块原样回传，本应用还没实现这一点。
- 旧版本 Ollama 对 `reasoning_effort: "none"` 的处理没有验证。
