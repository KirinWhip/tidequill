# Round 2 requirements (from user, verbatim intent)
Final release v1.0.1 (never move existing tags; if a build fails, publish a new patch version e.g. v1.0.2). Each stage: change list + dark/light screenshots + Windows runner unit+E2E with report link (Actions run + uploaded HTML report artifact). Things not verifiable in real env (auto-update download/install, launch at login, old-data migration) must be listed separately with concrete manual test steps for the user. CHANGELOG.md for notes, Release with SHA256SUMS.txt.
First: honest self-audit (done / placeholder / untested).

A (bugs, first):
1. Cost display: when model has no price, show "—"/"未配置价格" under title bar and in message footer; click jumps to price table to add that model.
2. Input tokens too high ("你好 你是谁 你能干啥?" = 409 input tokens). Investigate and explain exactly what each request sends (system prompt, tool defs...). With no plugin/MCP enabled, do not send tools. Add "查看本次请求内容" debug entry in conversation settings.
3. Model claimed "可以手动开启联网搜索", "支持上传 Excel/PPT" which app lacks. Check default system prompt and tool descriptions; never imply nonexistent features.
4. Single newlines render as line breaks in blockquotes and normal messages (remark-breaks or equivalent), e.g. four-line poem.
5. Deep thinking: verify params per provider against official docs (DeepSeek per its docs, not uniform reasoning_effort). Ensure reasoning field displays. Update outdated README note "DeepSeek 思考过程暂不显示".
6. README: repo is public, remove "private / update check fails" note; move version history (v0.3/v0.4/v1.0) to CHANGELOG.md; README structure: 简介、功能、安装、使用、开发、许可证; add README.en.md.
7. Auto title: after first reply, one short request to summarize a title <=10 chars; toggle in settings; never overwrite after user manual rename.

B (UI):
8. Custom title bar (or titleBarOverlay), colors follow theme, not system accent.
9. Settings > Providers: model list as chips (searchable, add/remove, checkable); "获取模型" and "删除" separated, delete needs confirmation; API key field show/hide + "测试连接" with success/failure reason inline; "已保存" feedback on changes; Ollama etc status badges reflect real connection status with tooltip; explicit "default model" rule explained in UI.
10. Sidebar bottom simplified: import/export moved to Settings > Data; personas, prompt library, image gen, plugins grouped clearly; distinct import/export icons.
11. All top-right icons have tooltips (incl. shortcuts); empty "folders" shows guidance text.
12. Reading width setting (narrow/standard/wide); message action buttons appear on hover.
13. Context usage indicator above input (used / model window), warn near limit.

C (features):
14. Web search: selectable provider (Tavily / SearXNG / Bing etc., keys encrypted), toolbar toggle, citations shown in reply.
15. Attachments: xlsx, pptx text extraction, optional image OCR; clear message for oversized files.
16. Sandboxed preview for HTML/SVG code blocks in assistant replies (sandbox iframe, no script access to app).
17. Optional: same question to multiple models side by side.
18. In-conversation find (Ctrl+F) with highlight.
19. Optional voice input (Web Speech or compatible STT API).

D (security/reliability):
20. Production disables F12/devtools by default; Settings > General > Developer mode.
21. Plugins run in a separate utilityProcess; on first load show plugin path + SHA256 for user confirmation; README states risks.
22. MCP stdio: when adding a server, dialog shows full command line + args for confirmation; "always allow" scoped per server+tool; plugin page lists and can revoke all grants.
23. Storage: all JSON writes atomic (temp + rename), keep last N auto-backups, detect corruption at startup and auto-restore from backup; evaluate SQLite migration — write a comparison + migration risk doc, DO NOT migrate.
24. Scan repo + git history for leftover API keys, local paths, usernames; also screenshots and test reports.
25. SECURITY.md, Dependabot, npm audit and CodeQL CI, issue templates.
26. Repo About description: remove "Chatbox-like", neutral description.
