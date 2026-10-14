# Security Policy / 安全策略

## Supported versions / 支持的版本

| Version | Supported |
|---|---|
| 1.0.x (latest release) | Yes |
| < 1.0 | No |

Security fixes are released as a new patch version; the app's built-in updater (Settings → System → Check for updates) installs it.
安全修复会以新的补丁版本发布，可通过应用内更新（设置 → 系统 → 检查更新）安装。

## Reporting a vulnerability / 报告漏洞

Please report privately through GitHub: **Security → Report a vulnerability** on https://github.com/KirinWhip/tidequill/security/advisories/new . Do not open a public issue for security problems.
请通过 GitHub 的私密漏洞报告（上面的链接）提交，不要公开提 issue。

Please include the version, OS, steps to reproduce and the impact you expect. Never include real API keys.
请附上版本、操作系统、复现步骤和可能的影响，不要附带真实的 API 密钥。

This is a personal open-source project maintained in spare time: I aim to acknowledge reports within 7 days and to ship a fix for confirmed high-impact issues as soon as practical. There is no bug bounty.
这是业余维护的个人开源项目：一般会在 7 天内回复，确认的高影响问题会尽快发布修复。没有漏洞赏金。

## Scope and known limitations / 范围与已知限制

In scope, for example / 属于安全问题的例如:
- the renderer (chat content, Markdown, HTML/SVG previews, model output) reaching Node.js, IPC or files it should not
- API keys leaving the machine other than to the configured provider, or being stored unencrypted when OS encryption is available
- a plugin or stdio MCP server running without the confirmation described below
- update integrity problems

Known, documented limitations (not vulnerabilities by themselves) / 已知并已说明的限制:
- **Plugins** run as Node.js code with your user account's permissions. Since 1.0.1 they run in a separate utility process and need a path + SHA-256 confirmation before the first load (and after every change), but this is process isolation, not a sandbox. Only install plugins you trust.
  插件拥有与你的用户账户相同的权限；1.0.1 起运行在独立进程并需确认路径和 SHA-256，但这不是沙箱。
- **stdio MCP servers** start local programs. The exact command line must be confirmed; after that the program runs with your permissions.
- **Developer mode** (Settings → General) opens DevTools, which can read all app data; it is off by default.
- The Windows installers are **not code-signed** (see README); verify downloads with `SHA256SUMS.txt` from the release.
- API keys are encrypted with Electron safeStorage (DPAPI on Windows). Anyone who can run code as your user can decrypt them.

## Automated checks / 自动检查
- `npm audit` on every push, pull request and weekly (`.github/workflows/security.yml`): all findings are listed in the job summary; the job fails on high/critical advisories in code that ships inside the app (bundled npm packages and Electron).
- CodeQL (`javascript-typescript` and `actions`, security-extended queries) on every push, pull request and weekly.
- Dependabot for npm and GitHub Actions.
- A secret scan (gitleaks, full history) was run before 1.0.1; see `docs/self-audit-round2.md`.
