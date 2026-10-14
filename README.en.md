<p align="center"><img src="build/icons/128x128.png" width="96" alt="Tidequill"></p>

# Tidequill (潮笺)

[简体中文](README.md) | English · [Changelog](CHANGELOG.md)

## Introduction

**Tidequill** is an independent, MIT-licensed, cross-platform desktop AI chat client built with **Electron + React + TypeScript + Vite**. The UI language follows the system: Simplified Chinese on Chinese systems, English elsewhere. You can switch it in Settings → General.

| Light · 中文 | Dark · 中文 |
|---|---|
| ![](screenshots/r2-C/light-zh.png) | ![](screenshots/r2-C/dark-zh.png) |
| **Light · English** | **Dark · English** |
| ![](screenshots/r2-C/light-en.png) | ![](screenshots/r2-C/dark-en.png) |

## Features

- **Providers**: OpenAI and any OpenAI-compatible API (DeepSeek, xAI Grok and Qwen are preset), Anthropic Claude, Google Gemini, and Ollama (local, auto-detected). You can fetch model lists with one click and pick a provider and model per conversation.
- **Chat**:
  - Streaming and stop.
  - Regenerate and edit & resend; old versions are kept as branches.
  - Fork to a new conversation, quote reply, delete a single message, read aloud.
  - Auto title: after the first reply, a short title is summarized. You can turn this off, and a manual rename is never overwritten.
- **Deep thinking**: sends the parameters documented by each provider (see the table below). The reasoning appears in a collapsible block.
- **Rendering**:
  - Markdown (GFM), where a single newline is a line break.
  - Code highlighting with copy, line numbers and folding.
  - KaTeX math, and Mermaid diagrams with zoom, copy source and SVG download.
- **Organization**:
  - Folders, tags, pinning and renaming.
  - Full-text search with snippets and batch delete.
  - Per-conversation system prompt and sampling parameters.
- **Usage & cost**: token counts and estimated cost for each message and each conversation. The price table is editable. Models with no price show "No price set", and clicking it takes you to the price table to add one.
- **Request transparency**: Conversation settings → "View request content" shows the system prompt, tool definitions and messages (bytes plus a token estimate) and the full JSON body of the last request. The API key is never shown. By default no system prompt and no tool definitions are sent.
- **Attachments & images**:
  - PDF, DOCX, **XLSX, PPTX**, TXT/MD/CSV/JSON and code files; their text is extracted into the context. XLSX gives the cell values of every sheet (formulas are not recalculated; the value saved in the file is used). PPTX gives the text and speaker notes of each slide. Legacy .xls / .ppt / .doc are not supported.
  - Files over the size limit (20 MB by default, changeable in Settings → Chat) get a clear message with the file size and the limit.
  - Images go to vision models. Optional local text recognition (OCR with tesseract.js), off by default; language data is downloaded on demand.
  - Image generation uses the OpenAI Images API.
- **Web search**: Tavily, SearXNG (self-hosted), Brave Search, and Bing Web Search compatible endpoints (Microsoft retired the official Bing Search API on 2025-08-11). One toggle in the composer toolbar; [1]-style markers in the reply and the "Sources" list link to the pages. Search keys are encrypted with safeStorage and requests are made by the main process.
- **Code preview**: HTML / SVG code blocks in replies can be previewed in a sandbox (an isolated iframe; scripts cannot reach the app, keys or the network).
- **Compare models**: send one question to up to 4 models and see the replies side by side; the answer you choose stays in the context.
- **Find in conversation**: `Ctrl+F` highlights all matches; Enter / Shift+Enter to step through them.
- **Voice input** (optional): transcription through an OpenAI-compatible `/audio/transcriptions` API (e.g. whisper-1). Web Speech is not used.
- **Plugins / MCP**: MCP servers over stdio or HTTP (Streamable HTTP with SSE fallback), plus a simple CommonJS plugin API. Every tool call asks you to confirm.
- **Data**:
  - Local JSON storage, with API keys encrypted by safeStorage.
  - Backup and restore.
  - Markdown, JSON and PDF export.
  - Optional WebDAV sync.
- **UI**: custom title bar in theme colors (the window buttons are drawn by the OS), adjustable reading width, a context usage indicator, and grouped sidebar tools.
- **System**: global shortcut `Ctrl+Shift+Space`, tray, launch at login, and update checks via GitHub Releases.

## Installation

Download the Windows installer (`Tidequill-Setup-<version>-x64.exe`) or the portable build (`Tidequill-<version>-portable.exe`) from [Releases](https://github.com/KirinWhip/tidequill/releases/latest), plus `SHA256SUMS.txt`.

- **Unsigned build**: a code-signing certificate costs money every year, so the exe is unsigned and Windows SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.
- **Installer**: you can install for all users or only for yourself, and choose the folder. To uninstall, go to Settings → Apps → Tidequill. Your data stays in `%APPDATA%\Tidequill`.
- **Portable**: runs from any folder. It starts a little slower because it unpacks to a temp folder, and it does not auto-update.
- **Verify SHA256** in PowerShell:
  ```powershell
  Get-Content .\SHA256SUMS.txt | ForEach-Object {
    $h, $f = $_ -split '\s+\*?', 2
    if (Test-Path $f) { '{0}  {1}' -f $f, ((Get-FileHash $f -Algorithm SHA256).Hash -eq $h.ToUpper()) }
  }
  ```

## Usage

1. On first launch, pick a provider, enter your API key, then click **Test connection** and **Get started**.
2. Choose the provider and model at the top. **Deep thinking** turns reasoning on. The gear icon opens conversation settings: parameters, folder, tags and the request view.
3. Shortcuts: `Ctrl+N` new chat, `Ctrl+K` search, `Ctrl+,` settings, `Ctrl+D` deep thinking, `Ctrl+Shift+S` conversation settings, `Ctrl+Shift+P` system prompt, `Ctrl+E` export, `Ctrl+F` find in conversation, `Esc` close. Button tooltips also show their shortcuts.
4. Settings → Providers:
   - Status badges show the real connection state, and hovering shows the reason.
   - The API key can be shown or hidden, and "Test connection" reports its result inline.
   - Models appear as chips you can search, add and remove; unchecked models are hidden from the model selector.
   - Deleting a provider asks for confirmation.
   - The default model applies to new chats only.
5. The bar above the input shows the estimated context the next request will use, against the model window, and warns above 80%. Edit the windows in Settings → Usage.
6. Settings → Chat → Reading width offers narrow, standard or wide. Import and export are in Settings → Data.
7. Web search: in Settings → Web search pick a service and enter its key (for SearXNG enter the URL and enable the json format in its settings.yml), click "Test search", then turn on the "Web search" toggle under the input box. Results are only added to that request, not saved into the conversation text.
8. Image text recognition: Settings → Chat → Image text recognition, tick the languages and click "Download" (English about 2.9 MB, Simplified Chinese about 1.7 MB; the default source is @tesseract.js-data on jsDelivr and can be changed), then tick "Recognize text in added images". Recognition runs locally.
9. Voice input: Settings → Chat → Voice input, turn it on and choose an OpenAI-compatible provider and model (e.g. whisper-1). Click the microphone under the input box to record and again to stop and transcribe. The app only asks for the microphone after you click the button.
10. Compare models: click "Compare models" in the conversation header and add up to 3 models; turn compare off to go back to a single model.

### Why are input tokens higher than my message?
A request can also carry:
- a system prompt (none by default);
- tool definitions (not sent by default; sent only when plugins or MCP are enabled, and each tool costs tokens);
- history messages within the context length;
- the provider's own message framing.

Use **View request content** to see exactly what was sent.

### Deep thinking parameters
| Provider | On | Off | Reasoning field | Docs |
|---|---|---|---|---|
| DeepSeek (api.deepseek.com) | `thinking: {type: "enabled"}`, `reasoning_effort: "high"` | `thinking: {type: "disabled"}` (thinking is on by default upstream) | `reasoning_content` | [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) |
| OpenAI o-series / gpt-5 | `reasoning_effort: "high"` | not sent | not shown (Chat Completions; Responses API reasoning summaries not implemented) | [Reasoning](https://developers.openai.com/api/docs/guides/reasoning) |
| Claude 4.6+ / 5.x | `thinking: {type: "adaptive", display: "summarized"}` | not sent | `thinking_delta` | [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) |
| Claude ≤ 4.5 | `thinking: {type: "enabled", budget_tokens}` (≥1024, < max_tokens) | not sent | `thinking_delta` | [Extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking) |
| Gemini 3 | `thinkingConfig: {includeThoughts: true, thinkingLevel: "high"}` | not sent | parts with `thought: true` | [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) |
| Gemini 2.5 | `thinkingConfig: {includeThoughts: true, thinkingBudget: -1}` | not sent | same | same |
| Ollama (/v1) | `reasoning_effort: "high"` | `reasoning_effort: "none"` | `reasoning` | [OpenAI compatibility](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx) |

### Plugins
Drop a CommonJS `.js` file into Plugins/Tools → Open plugin folder. It should export `{ name, description, tools: [{ name, description, parameters, execute }] }`.

The builtin demo tools `get_current_time` and `calculator` are not sent unless you enable them in Settings → Chat.

**Plugin risks, please read:**
- A plugin is JavaScript code that runs on your computer with the same file and network permissions as your user account: it can read, change and delete files you can access and send data over the network. **Only install plugins you trust and whose source you have read.**
- Since 1.0.1, plugins run in a separate plugin process (Electron utilityProcess), not in the main process. A crash, hang or memory leak in a plugin no longer takes the app down (a call that takes longer than 60 s restarts the plugin process), and plugins cannot reach the app window, IPC, decrypted settings or API keys. **This is not a security sandbox**: the file and network permissions above still apply.
- Before a plugin is loaded for the first time, the app shows its full path and SHA-256 and waits for your confirmation. If the file changes (different SHA-256), it has to be confirmed again and is not loaded until then.
- Every tool call by the model asks for confirmation; "Always allow" applies only to that tool of that source (one plugin or one MCP server). Plugins/Tools → Permissions lists all grants, trusted plugins and confirmed MCP commands, each with Revoke, plus Revoke all.

### MCP servers
- A stdio MCP server starts a program on your computer. When you add one, a dialog shows the full command line and every argument, and the server only starts after you confirm. Changing the command, arguments or environment later needs a new confirmation (unconfirmed servers, e.g. from imported settings, show "Command not confirmed, not started").
- HTTP servers do not start local programs, so there is no command to confirm; tool calls still ask for confirmation.

### Developer mode
The installed app disables F12 / developer tools by default (they can read and change all app data). Turn on Settings → General → Developer mode while troubleshooting, then press F12.

### Data safety (atomic writes, automatic backups)
- Every data file is written to a temporary file, flushed to disk and then renamed over the old one, so a crash or power loss mid-write keeps the previous file.
- At startup, and while running (at most every 10 minutes per file, only when it changed), data files are copied to `%APPDATA%\Tidequill\backups\<name>\`; the newest 5 copies per file are kept.
- If a data file cannot be parsed or has the wrong shape at startup, it is renamed to `<name>.corrupt-<time>.json` and the newest valid backup is restored automatically; a banner says which file was restored. Without a valid backup the file is reset, with the same kind of notice.
- Storage is still JSON files. An evaluation of moving to SQLite is in [docs/sqlite-evaluation.md](docs/sqlite-evaluation.md) (not migrated).

## Development

You need Node.js 20 or later.

```bash
npm install
npm run dev                 # Vite + Electron with hot reload
npm test                    # unit tests (vitest)
npm run build               # type-check + build renderer/main + third-party notices
npm run pack:linux-dir && ./scripts/e2e-linux.sh   # Linux E2E (Xvfb + gnome-keyring)
npm run dist:win && npx playwright test            # Windows package + E2E
```

CI (`.github/workflows/ci.yml`) runs on `windows-latest`: unit tests, packaging, E2E against the packaged exe, then uploads the Playwright HTML report and screenshots. Pushing a `v*` tag creates a Release that includes `SHA256SUMS.txt`.

## License

MIT (see `LICENSE`). Tidequill is an independent implementation and reuses no code or assets from GPL projects such as chatboxai/chatbox. See [`docs/LICENSE-AUDIT.md`](docs/LICENSE-AUDIT.md). Third-party components are listed in [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt) and on the in-app About page.
