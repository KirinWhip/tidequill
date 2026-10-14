# 更新日志 / Changelog

本文件记录各版本的变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
This file lists the changes in each version, in the style of Keep a Changelog.

## [未发布 / Unreleased]（Round 2 · 阶段 A，计划随 v1.0.1 发布）

### 新增 / Added
- 模型没有配置价格时，标题栏下方和消息底部显示“未配置价格”/“—”，点击后跳到 设置 → 用量 的价格表，可以一键添加该模型。
- 对话设置 → “查看本次请求内容”：显示最近一次请求的地址（密钥已脱敏）、系统提示词、工具定义、消息的大小和 token 估算，以及完整的 JSON 请求体。请求头不显示。
- 自动生成标题：首次回复后再发一次简短请求，总结出不超过 10 个字的标题。可在 设置 → 对话 中关闭；手动改过名的对话不会被覆盖。
- 设置 → 对话 → “发送内置演示工具（当前时间、计算器）”，默认关闭。

### 变更 / Changed
- **默认不再发送工具定义**：内置的 2 个演示工具会给每次请求增加约 406 字节的 JSON，提供方还会额外注入函数调用模板，所以改为默认不发送。插件 / MCP 工具在启用工具调用时照常发送。
- 深度思考参数按各家官方文档重写：
  - DeepSeek 官方接口：开启时发送 `thinking: {type: enabled}` 和 `reasoning_effort: high`，关闭时显式发送 `thinking: {type: disabled}`；带工具时回传历史消息的 `reasoning_content`。
  - Ollama：`/v1` 接口改用 `reasoning_effort`，不再发送 `think`。
  - Claude 4.6 及以上和 5.x：使用 `thinking: {type: adaptive, display: summarized}`。
  - Gemini 3：使用 `thinkingLevel`；Gemini 2.5：使用 `thinkingBudget: -1`。
- 单个换行会显示为换行（remark-breaks），引用块里的诗句可以逐行显示。
- 预置 DeepSeek 模型改为 `deepseek-flash`、`deepseek-v4-pro`，并补充了价格。
- README 按“简介 / 功能 / 安装 / 使用 / 开发 / 许可证”重新组织，新增英文版 README.en.md，版本历史移到本文件。

## [1.0.0] — P3：发布与合规
- 更名为 **潮笺 Tidequill**，启用原创图标（同时用于托盘）。
- exe 版本信息：ProductName、FileVersion 1.0.0、CompanyName 追逐。
- 新增“关于”页面：名称、版本、许可证、项目地址、第三方声明、检查更新。
- 改用 MIT 许可证，附许可证审计（docs/LICENSE-AUDIT.md）和 THIRD_PARTY_NOTICES.txt。
- CI 计算 SHA256，上传 SHA256SUMS.txt 并写入发布说明。
- 从 0.x 升级时自动迁移旧数据目录。

## [0.4.0] — P2
- 对话级设置：系统提示词、温度、Top P、最大输出 Token、上下文消息数。
- 编辑重发和重新生成都会保留分支，可在 ‹ 1/2 › 之间切换；支持从某条消息分支到新对话、删除单条消息、引用回复。
- 网络：自定义 API 地址、HTTP / SOCKS 代理、超时、指数退避重试；错误提示细分为多种可读的类型。
- 用量与费用：每条消息和整个对话的合计，价格表可编辑。
- 文件夹、标签、右键菜单、全文搜索（显示命中片段）、多选批量删除。
- Ollama 本地检测；完整备份 / 恢复；Markdown / JSON / PDF 导出；WebDAV 同步。
- 全局快捷键、系统托盘、开机启动、更新检查；首次启动引导。

## [0.3.0] — P1 界面
- 图标统一换成 Lucide，引入设计令牌，浅色和深色主题都满足 WCAG AA 对比度。
- 模型下拉框支持搜索，模型列表缓存 24 小时，也可以输入自定义模型名。
- 新增“深度思考”开关，思考过程可折叠显示。
- 输入区新增工具栏；消息悬停时显示操作按钮；代码块、表格、Mermaid 的显示更完善。

## [0.2.0] — P0
- 中英文界面（i18n）。
- 安全加固：sandbox、CSP、所有请求经主进程转发、safeStorage 加密密钥。
- 新增模拟服务器、Playwright E2E 和 Windows CI。
