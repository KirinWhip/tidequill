# Round 3 报告（v1.0.2）

每项按“改了什么 / 怎么验证的 / 哪些没法验证”记录。PR 均为分支 + PR，Windows CI、Security（npm-audit）、CodeQL 全绿后 squash 合并。

| PR | 内容 | 结果 |
|---|---|---|
| #12 | Round 3 自查报告 | 已合并 |
| #13 | A1：代码扫描告警 #2–#5，r2b 不稳定测试 | 已合并 |
| #14 | A1：React 19.3（合并 Dependabot #10 + #11） | 已合并；#10、#11 关闭 |
| #15 | A2：最大化窗口贴合工作区 | 已合并 |
| #16 | A3 + A4：对话开关默认关闭；联网搜索体验 | 已合并 |
| #17 | A5：Claude 400 | 已合并 |
| #18 | A6：密钥不进入渲染进程 | 已合并 |
| #19 | B7–B12 | 已合并 |
| #20 | Mermaid 12.2 + EPL-2.0 许可政策（取代 Dependabot #7） | 已合并；#7 关闭 |
| release-prep | 版本 1.0.2、CHANGELOG、文档、截图、CI download-artifact v8 | 见最终报告 |

## A1 依赖与代码扫描
**改了什么**
- React 19.3 + react-dom 19.3（#14）：仅类型调整（`useRef` 需要初值、`RefObject<T | null>`）；代码中没有 forwardRef / defaultProps / propTypes / 旧版 render API。
- 告警 #2 ReDoS（mock-server multipart 解析改为 indexOf）、#3 不安全随机数（`randomToken` 使用 `crypto.getRandomValues`，用于 uid 与 multipart boundary）、#4 明文存储（浏览器回退 KV 改为内存 Map，不再写 localStorage）、#5 远程属性注入（字段放入 Map）（#13）。
- r2b.spec.ts:80 不稳定：断言瞬时的“已保存”标志会因 1.5 s 计时器过期而失败；改为断言保存计数 `data-save-count`，并把标志延长到 2.5 s（#13）。
- CI actions：checkout / setup-node / upload-artifact 已是 v7（Node 24）；本次把 release 任务的 download-artifact v4（Node 20）升级到 v8。
- Mermaid 12（#20）：见下文“Mermaid 12 与许可”。

**怎么验证的**
- #14 证据：本地 174 个单元测试、97 个 Linux E2E 通过；Windows CI https://github.com/KirinWhip/tidequill/actions/runs/38564200351 通过（含全部 E2E）。之后各 PR 均在 React 19 上全绿。
- 代码扫描 API：告警 #1–#5 状态均为 `fixed`。
- 弃用注解：检查 main 最近的 CI / Security / CodeQL 运行的全部 check-run annotations，没有 Node 20 弃用提示；唯一注解是 GitHub 关于 ubuntu-latest 将于 2026-10-19 迁移到 Ubuntu 26 的通知（非本项目问题）。release 任务只在 tag 上运行，tag 构建的注解结果见最终报告。

**哪些没法验证**
- React 19 在真实用户机器上的长期稳定性只能靠实际使用。

## A2 最大化窗口超出屏幕
**改了什么**
- `fitToWorkArea`：最小尺寸（800×500）和初始尺寸不超过当前显示器工作区。
- 防御性处理：最大化后若客户区超出工作区，改为把窗口设为工作区大小（再次“最大化”按钮可还原）。测试用环境变量 `TIDEQUILL_TEST_MAX_OVERFLOW` 强制走这条路径。
**怎么验证的**
- 先在测试分支 a2-baseline（未改代码，CI run 38565316146）测量：100 / 125 / 150% 下最大化几何本来就正确；唯一问题是 150% 下还原后宽度超出（最小宽度 800 > 工作区 683）。
- 新增 e2e/r3-window.spec.ts（仅 Windows）：三种缩放下最大化与还原都在工作区内，截图 `screenshots/r3/maximized-{100,125,150}.png` 与几何 JSON；强制溢出路径测试通过。
**哪些没法验证**
- **用户报告的“最大化超出屏幕”在 CI 上无法复现**；修复是最小尺寸收紧 + 防御性回退。真实显示器、贴靠、多显示器见 MANUAL-TESTS 第 10 节。

## A3 对话开关默认关闭
**改了什么**：深度思考 / 工具 / 联网搜索 按对话保存（`Conversation.tools / webSearch`），新对话取 设置 → 对话 → “新对话默认开启”（默认全关）；1.0.1 升级的设置没有该字段时也全关；开关悬停说明效果和 token 成本。
**怎么验证的**：e2e/r3.spec.ts A3 两个用例：默认全关且请求不带 tools / reasoning / 搜索；A、B 两个对话各自保持状态；默认值可配置；升级场景。截图 toggles-tooltip-*.png。
**哪些没法验证**：真实服务商下的 token 成本数字。

## A4 联网搜索体验
**改了什么**：未配置密钥时开关禁用，旁边“去设置填写”链接直达搜索设置；搜索失败时回复上方显示可折叠提示（重试搜索 / 关闭联网），成功回复不显示。
**怎么验证的**：e2e/r2c.spec.ts 搜索用例（错误密钥 → 折叠提示 → 重试 → 关闭；无密钥 → 禁用 + 链接 + 不发搜索请求）。截图 search-failure-notice.png、search-disabled-hint.png。
**哪些没法验证**：真实 Tavily / Bing / Brave / SearXNG 的错误格式（mock 模拟）。

## A5 Claude 400
**改了什么**
- 根因：1.0.1 关闭深度思考时发送 `temperature: 0.7`，Claude 4.7+ / 5.x 对任何非默认采样参数一律返回 400；开启思考时会去掉 temperature，所以“重试/换设置”有时又能成功。
- 适配器按 platform.claude.com 文档规则：4.7+ 和开启思考时不发采样参数；5.x 关闭思考：Sonnet 5.5 用 `between_tools`，Haiku 5.5 / Opus 5 / Sonnet 5 用 `disabled`，Opus 5.5 / Fable / Mythos 不能关闭；4.7+ 开启用 `adaptive` + `display: summarized`，4.5 及更早用 `enabled` + budget；工具轮次先回传带签名的 thinking 块；工具名与 schema 规范化；不发送空白文本块。
- 错误卡片：服务器原文 + 脱敏请求摘要（不含正文、图片、密钥），按钮 重试 / 关闭深度思考后重试 / 复制详情。
**怎么验证的**：tests/r3-anthropic.test.ts 复现 1.0.1 请求（sonnet-5-5 + temperature 0.7 → 400）；严格的 Anthropic mock（tests/mock-anthropic.mjs）按规则校验；e2e/r3-anthropic.spec.ts，截图 error-400-details.png。
**哪些没法验证**：没有真实 Anthropic 密钥，未对真实 API 发请求；用户的原始操作步骤无法逐一复现。

## A6 密钥只在主进程
**改了什么**：渲染进程只拿到按槽位加盐的占位符；主进程在 HTTP 桥接中只对绑定的主机插入真实密钥（请求头、URL、Basic、JSON 正文），其他主机拒绝；SecretField 显示 已保存 / 替换 / 清除；地址变更提示；备份导出 / 导入在主进程处理密钥；IPC 审计日志（测试用）。
**怎么验证的**：tests/vault.test.ts；e2e A6：窗口状态、IPC 载荷、存储中都没有明文密钥，请求仍带正确认证；替换 / 清除流程。截图 saved-key-ui.png。
**哪些没法验证**：系统加密存储（DPAPI）在其他用户账户 / 漫游配置下的行为。

## B7–B12
| 项 | 改了什么 | 怎么验证 | 没法验证 |
|---|---|---|---|
| B7 状态标签 | 未配置 / 已配置 / 连接正常 / 连接失败；悬停与详情显示上次测试时间；Ollama 通过 /api/tags 检测 | e2e B7；截图 badges.png、badges-tooltip.png | 真实 Ollama 安装 |
| B8 模型下拉 | 按系列分组，新版本在前（版本号，日期作次序），每组 3 个，其余“显示更早的模型”；搜索显示全部；主题化滚动条；未知系列不折叠 | tests/r3-b.test.ts；e2e B8；截图 model-dropdown-grouped.png | 各服务商未来命名规则 |
| B9 自动标题 | 根因：首条回复失败时写入首句占位标题，导致以后永不生成；且 5.x 上标题请求本身也会 400（A5 已修）。新增 `titleSource`，首次成功回复后生成；maxTokens 120 | e2e B9：mock-401 失败 → 换模型成功 → 标题变为模拟标题 | 真实模型标题质量 |
| B10 上下文用量 | 悬停分项（系统提示词 / 工具定义 / 历史 / 输入）；用上次真实 input 用量校准（偏差 > 15%，系数限 0.5–3） | 单元测试；e2e；截图 context-usage-breakdown.png | 各服务商 tokenizer 的精确差异 |
| B11 顶栏 | 所有图标主题化提示（含分栏对比说明），提示向内对齐且不会让页面滚动；费用不截断 | e2e；截图 topbar-compare-tooltip.png | — |
| B12 告知型号 | 设置 → 对话 可选（默认关闭），系统提示词末尾附“当前使用的模型是 …” | 单元测试；e2e 检查请求系统消息 | — |

## Mermaid 12 与许可
**改了什么**：mermaid ^12.2.0（依赖 elkjs 0.9.3，EPL-2.0，未修改）；strict 安全级别 + DOMPurify 清洗不变。LICENSE-AUDIT 新增许可政策（宽松许可 + EPL-2.0；不接受 GPL / LGPL / AGPL 随包依赖），README 中英文说明，THIRD_PARTY_NOTICES 含 EPL-2.0 全文与源代码地址（gen-notices 自动生成）。
**怎么验证的**：Windows CI 109 通过（含 Mermaid 工具栏用例），本地截图检查布局无变化。
**哪些没法验证**：法律意见（按 EPL-2.0 常规义务处理）。

## 测试与不稳定用例
- 单元测试 280 个，Linux E2E 106 通过（4 个仅 Windows 的跳过），Windows E2E 109 通过（1 跳过）。
- 不稳定记录：#19 早期 Windows 运行中 r2c.spec.ts:347（语音输入计时显示）一次失败、重试通过；r3.spec.ts:192（B9）一次标记失败，最终运行通过；r3-anthropic 开启深度思考点击竞态（已改为等待 aria-pressed）；Mermaid 工具栏“元素不稳定”由顶栏提示溢出窗口引起（已修复）。

## 截图
`screenshots/r3/`：light-zh、dark-zh、light-en、dark-en、maximized-100/125/150、toggles-tooltip-{tools,reasoning,search}、search-disabled-hint、search-failure-notice、error-400-details、saved-key-ui、badges、badges-tooltip、model-dropdown-grouped、context-usage-breakdown、topbar-compare-tooltip、about-1.0.2。maximized-* 来自 Windows CI，其余来自本地 Linux（Xvfb）运行。
