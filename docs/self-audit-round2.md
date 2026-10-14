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

## 二、Round 2 各项当前状态（阶段 C 完成后）

### 阶段 A（本轮已做）
| # | 项目 | 状态 | 说明 / 未验证部分 |
|---|---|---|---|
| 1 | 未配置价格提示 + 跳转价格表 | ✅ | 标题栏下方显示“未配置价格”，消息底部显示“— 未配置价格”，点击打开 设置 → 用量 并提供“添加 <模型> 的价格”按钮。有 E2E。 |
| 2 | 输入 token 调查 + 默认不发工具 + 请求查看 | ✅ / ⚠️ | 抓包数据见第三部分。409 这个数字是用户在真实 DeepSeek 上看到的，本地只能估算。“工具定义加上服务端注入的函数调用模板是主要来源”是**推断**，没有用真实密钥复现。 |
| 3 | 不暗示不存在的功能 | ✅ / 🟡 | 已确认没有默认系统提示词，工具描述只有“获取当前时间”“计算表达式”，都没有提到联网或 Excel。所以那两句话是模型自己编的，客户端不能完全杜绝。已做的处理：默认不发工具；README 曾写明“不支持 Excel/PPT、没有联网搜索”；阶段 C 实现这两项后，这句说明已删除，改为如实描述支持范围。**没有**加“能力说明”系统提示词，因为它每次都会增加 token，与第 2 项冲突；如需要可在 B/C 阶段做成可选项。 |
| 4 | 单个换行显示为换行 | ✅ | 使用 remark-breaks。E2E 验证四行诗引用块中有 3 个 `<br>`。 |
| 5 | 深度思考参数按官方文档 | ✅ 构造 / ⚠️ 真实接口 | 文档链接和参数见第四部分。只有单元测试和模拟服务器验证，**没有用真实密钥调用任何一家**。Gemini generateContent 的 `thinkingLevel` 字段名没有在 REST 参考中逐字核对（抓取的页面被截断）。 |
| 6 | README 重构 + README.en.md + CHANGELOG.md | ✅ | 已删除“私有仓库”和“DeepSeek 思考过程暂不显示”两条说明。 |
| 7 | 自动标题 | ✅ | 设置里有开关；手动改名后设置 titleManual，不会被覆盖。E2E 覆盖了总结、关闭开关、手动改名三种情况。真实模型能否稳定给出 10 字以内的标题没有验证，客户端会裁剪到 10 个字。 |

### 阶段 B（本轮已做）
| # | 项目 | 状态 | 说明 / 局限 |
|---|---|---|---|
| 8 | 自定义标题栏 | ✅ Windows/Linux · ⚠️ macOS | 使用 Window Controls Overlay，背景和窗口按钮颜色跟随应用主题，切换主题时实时更新。E2E 校验了标题栏背景色等于主题色、可拖动区域、setTitleBarOverlay 调用成功。截图：Linux 用 ffmpeg 截整窗（含系统绘制的按钮）；**Windows CI 上的截图只有页面内容，不含系统绘制的窗口按钮**，需要用户在本机看一眼。macOS 用 hiddenInset，**未测试**。 |
| 9 | 提供方设置页 | ✅ | 包括：模型标签（搜索 / 添加 / 移除 / 勾选）；“获取模型”与“删除”分开，删除需确认；密钥显示 / 隐藏；测试连接结果直接显示；“已保存”提示；状态徽标加悬停说明；默认模型规则的说明。**状态徽标的检测方法是请求 /models**，这个接口能通不代表对话一定可用（例如余额不足）。均为模拟服务器加 E2E 验证，未用真实密钥。 |
| 10 | 侧边栏底部精简 | ✅ | “工具箱”分组；导入 / 导出移到 设置 → 数据；各项使用不同图标。 |
| 11 | 提示中显示快捷键、空文件夹引导 | ✅ | 提示中的快捷键都已实际绑定，E2E 用键盘逐个验证。 |
| 12 | 阅读宽度、悬停显示按钮 | ✅ | 窄 720 / 标准 980 / 宽 1280 px。 |
| 13 | 上下文用量指示 | ✅ / 🟡 | **token 数是估算**（与用量统计用同一个估算函数），不是供应商的 tokenizer。模型窗口是**预设表**（可在设置中编辑），可能与供应商实际值不同；未知模型显示“未知”。 |

### 阶段 C（本轮已做）
| # | 项目 | 状态 | 说明 / 局限 |
|---|---|---|---|
| 14 | 联网搜索 | ✅ 模拟接口 / ⚠️ 真实服务 | 支持 Tavily、SearXNG、Brave，以及 Bing v7 兼容端点。密钥用 safeStorage 加密（E2E 检查磁盘上是 `enc:v1:`，没有明文）。工具栏有开关；引用编号和来源卡片都链接到原网页；请求经主进程发出（E2E 检查主进程请求日志，并确认渲染进程直接 fetch 被拦截）。<br>**全部只用模拟接口测试，没有用真实的 Tavily / Brave 密钥或公开的 SearXNG 实例调用过。** 各服务的请求和响应格式按官方文档实现（Tavily POST /search + Bearer；SearXNG `format=json`；Brave `X-Subscription-Token`，`web.results`；Bing `Ocp-Apim-Subscription-Key`，`webPages.value`）。<br>**Bing**：微软已于 2025-08-11 停止官方 Bing Search API，所以这一项只对自建或第三方兼容端点有用，设置页有说明。<br>检索方式很简单：直接用用户这条消息原文作为搜索词，没有让模型改写搜索词；引用编号由模型自己输出，模型不按要求标注时就不会出现编号（来源卡片仍会显示）。 |
| 15 | xlsx / pptx / OCR / 超大文件提示 | ✅ / 🟡 | XLSX 和 PPTX 用 fflate（MIT）加自写解析器。测试文件由 openpyxl 和 python-pptx 生成，**没有用 Excel 或 PowerPoint 实际保存的文件测试过**。<br>已知不支持：公式不重新计算（没有缓存值时显示公式）；合并单元格、图表、图片、日期格式（日期显示为 Excel 序列号）都没有处理；幻灯片顺序按文件编号，没有按 presentation.xml 排序。<br>超大文件：按 设置 → 对话 中的上限检查，提示里有文件名、大小和上限；旧版 .xls / .ppt / .doc 也有明确提示。<br>OCR：tesseract.js 7（Apache-2.0），默认关闭。worker 和 wasm 核心随应用打包；语言数据需在设置中下载（默认来源 jsDelivr 上的 @tesseract.js-data/{lang}/4.0.0_best_int，可以改地址），保存在 `userData/ocr`。E2E 用仓库里的 eng 数据（2.9 MB）通过模拟服务器下载后，实际识别了一张英文图片。**中文识别没有测试过**，识别质量取决于图片。 |
| 16 | HTML / SVG 沙箱预览 | ✅ | 实现方式：tqpreview: 协议，响应头和 meta 中都带 CSP；iframe 只设 `sandbox="allow-scripts"`，没有 allow-same-origin；应用 CSP 的 `frame-src` 只允许 tqpreview:；主进程禁止子框架导航到其他地址。<br>E2E 用一段攻击脚本验证：读 parent / top 的 DOM、parent.api 都报 SecurityError；window.api、require、process、ipcRenderer 都是 undefined；`self.origin` 为 "null"；cookie 和 localStorage 被拒绝；window.open 返回 null；无法让顶层页面跳转；fetch 被拦截，模拟服务器没有收到请求；应用标题没有被修改；应用也读不到 iframe 的 contentDocument。<br>局限：预览里的脚本可以执行，死循环会卡住执行它的渲染进程。我没有额外做进程隔离，这个 iframe 是否和应用在同一进程取决于 Chromium 的站点隔离，未验证。 |
| 17 | 多模型并排 | ✅ | 包括原问题的模型，最多 4 个模型并行回答，并排显示；可以选择“采用此回答”，E2E 验证下一轮请求只带被采用的回答。<br>局限：对比模式不调用工具；不能对单个回答单独重新生成（重新生成会让整组重来）；4 列在窄窗口里比较挤（4 个时排成 2×2）。 |
| 18 | 对话内查找（Ctrl+F） | ✅ | 用 CSS Custom Highlight API 高亮，不修改 DOM。E2E 检查了计数、前后跳转、不区分大小写、当前匹配可见、Esc 清除高亮。<br>局限：跨格式边界的匹配找不到（例如一半粗体、一半普通文字）；折叠的思考过程、折叠的代码块，以及预览 iframe 里的内容不参与查找。 |
| 19 | 语音输入 | ✅ 模拟接口 / ⚠️ 真实麦克风和服务 | MediaRecorder 录音（webm/opus），通过 OpenAI 兼容的 /audio/transcriptions（multipart）转写。<br>麦克风权限：只有点击按钮后 10 秒内、仅音频、来自应用主框架的请求会被允许一次。E2E 验证了页面脚本自己发起的请求、视频请求、以及用过一次之后的请求都被拒绝。<br>E2E 用 Chromium 的假音频设备（`--use-fake-device-for-media-stream`）录音，并检查模拟服务器收到了大于 1 KB 的 audio/webm 数据。**没有用真实麦克风测试过，也没有调用过真实的 OpenAI 转写接口。**<br>没有使用 Web Speech（Electron 中没有 Google 的语音服务密钥，通常不可用）。macOS 会调用系统的麦克风授权，但**未测试**。 |

### 阶段 D（尚未开始）
| # | 项目 | 状态 |
|---|---|---|
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
6. **阶段 C 真实服务**：
   1. 用真实的 Tavily 或 Brave 密钥（或自建的 SearXNG）开启联网搜索提问，检查来源是否正确。
   2. 用 OpenAI 密钥开启语音输入，对着真实麦克风说一句话，检查转写结果。
   3. 用 Excel 实际保存的 .xlsx（含日期和合并单元格）添加为附件，检查提取的文字。
   4. 下载中文 OCR 数据，识别一张中文截图。

## 二点五、阶段 A CI 中 2 个 Windows E2E 偶发超时的根因

**现象**：Windows runner 上偶尔出现“请求超时”，涉及 p2 的 Ollama 和 app 的流式测试。测试中桥接层的空闲超时设为 3 秒。

**排查**：建了专门的诊断分支，让 Windows CI 把 p2 和 app 各重复 3 遍，并采集主进程请求计时、代理解析耗时、主进程和 Playwright worker 的事件循环卡顿、模拟服务器的连接日志，以及 Chromium NetLog。
- 诊断运行 38540270497：132 个测试中复现 3 次超时。
- 诊断运行 38541864790：132 个测试中复现 1 次，这次带 NetLog。

排除了以下原因：
- 代理解析（WPAD）：最多 60 ms。
- 模拟服务器所在的 worker 卡顿：没有超过 350 ms 的卡顿。
- 失败的请求根本没有连到模拟服务器。

**根因**：NetLog 显示，每个进程的第一个请求都会在 `COMPUTED_PRIVACY_MODE` 和 `NETWORK_DELEGATE_BEFORE_START_TRANSACTION` 之间等待 `COOKIE_PERSISTENT_STORE_LOAD`，也就是 Chromium 在第一次请求时才从磁盘加载 profile 中的 SQLite Cookie 库。
- 等待时间中位数约 130 ms，但出现过 1370 ms，失败的那次长达 4765 ms。可能是 Windows runner 的磁盘或杀毒扫描导致，这一点是推测。
- 同一进程中后续请求的等待不超过 1 ms。
- 每个测试都是新的 profile，所以每个测试的首个请求都要经历一次这个等待。

**修复**：API 请求（模型请求和 WebDAV）改走内存会话 `session.fromPartition('tidequill-api', { cache: false })`，它不会读取磁盘上的 Cookie 库。代理设置同时作用于这个会话。**测试超时没有改动。**

**验证**：修复后的诊断运行 38542998359 在 Windows 上通过 132/132，重试设为 0。
- 153 个请求中，从发出到收到响应头的时间中位数 35 ms，最大 48 ms；修复前最大达到 4765 ms。
- 日志里有 3 次 timeout，都来自故意制造超时的用例 `mock-timeout`（重复跑了 3 遍），属于预期结果。
- 只验证了一次 132 个测试的运行，不能证明以后永远不会再出现超时，但已经排除了已知的根因。

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
