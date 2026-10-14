# Round 3 requirements (user tested B-stage build; release as v1.0.2 since v1.0.1 exists; About page shows version)
Every item: what changed, how verified, what can't be verified. First: honest self-audit of current version (round 2 done / unfinished / untested).
Process: no pushes while CI red; no direct commits on main — branch + PR; Release only when CI fully green.

A (must fix first):
1. CI: user saw Actions #14 (5b73616) windows job exit 1. Read its e2e-report-windows artifact, list failed tests + causes (it was reading-width, fixed in 2bc8e40 — confirm with evidence). Ensure windows job green. Upgrade actions/checkout, setup-node, upload-artifact to Node-24 versions, remove deprecation warnings. Go through ALL open PRs and the Security/code-scanning alerts (user saw 5 PRs and 4 alerts); explain per item: merged/closed/fixed.
2. Frameless custom-title-bar window maximized overflows the screen (right close button + top cut off, left and bottom "设置/关于" cut off). Fix maximize/restore/snap; verify at 100/125/150% DPI (CI: --force-device-scale-factor, and check maximized bounds == workArea on windows runner); close button always visible.
3. New conversations: 深度思考, 工具, 联网搜索 all default OFF (defaults configurable in 设置→对话); each conversation remembers its own toggle state; tooltips on all three explaining effect and cost (slower, more tokens).
4. Web search: if no search key configured, toggle disabled with hint "去设置填写", cannot be enabled. Remove the orange warning line before every reply; only when a search actually fails show a collapsible small notice in that reply with "重试" / "关闭联网搜索".
5. Claude claude-sonnet-5-5: first message 400 "请求参数有误", second succeeds. In error "详情" show redacted request summary + server error body. Audit Anthropic adapter: thinking on => max_tokens > budget, no incompatible temperature/top_p, tool schema format. Reproduce with local mock Anthropic server regression test, fix. Error card buttons: 重试, 关闭深度思考后重试, 复制详情.
6. Renderer must never get plaintext keys. Saved key shows only "已保存" with 替换/清除; remove eye-reveal for saved keys (still allowed while typing a new one). All provider/search/STT/WebDAV calls get keys in main process.

B (improvements):
7. Provider badges: 未配置 / 已配置 / 连接正常 / 连接失败, show last test time; Ollama real status.
8. Model dropdown: grouped by family, newest first, older collapsed ("显示更早的模型"), scrollbar themed.
9. Verify auto-title actually works (currently title is still first sentence); generate only after successful first reply; not for failed conversations. Find root cause.
10. Context usage: explain estimation (system prompt / tools / history breakdown on hover), compare with provider-returned real tokens, correct if large deviation (e.g. calibrate using last real usage).
11. All top-bar icons text tooltips; explain the "分栏" (split) icon; top-right cost must not be truncated.
12. Optional setting "在系统提示词中告知模型当前型号" (default off).

Delivery: Windows runner e2e report links + dark/light screenshots; separately list unverifiable items (DPI scaling on real monitors, auto-update download/install) with manual test steps.
