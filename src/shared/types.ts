export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export interface ProviderConfig {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  baseURL: string
  models: string[]
  /** models unchecked in Settings > Providers: kept in the list but hidden from the model selector */
  hiddenModels?: string[]
}

export interface Attachment {
  name: string
  text: string
  /** how the text was obtained (shown on the chip) */
  kind?: 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'ocr'
  /** original file size in bytes */
  size?: number
  /** text was cut at the character limit */
  truncated?: boolean
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
}

export interface Message {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[] // data URLs
  attachments?: Attachment[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  model?: string
  error?: string
  errorCode?: string
  reasoning?: string
  usage?: { input: number; output: number; estimated?: boolean }
  quote?: string
  status?: string // transient (e.g. retry notice)
  /** web search results used for this reply */
  citations?: import('./websearch').Citation[]
  searchQuery?: string
  searchError?: string
  /** multi-model compare: replies to the same question share a group id; the chosen one stays in the context */
  compareGroup?: string
  compareChosen?: boolean
  createdAt: number
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  providerId: string
  model: string
  systemPrompt: string
  pinned: boolean
  reasoning?: boolean // deep thinking toggle
  titleManual?: boolean // user renamed it: auto-title never overwrites
  params?: ConvParams // per-conversation overrides of global defaults
  folderId?: string
  tags?: string[]
  branches?: Record<string, import('./branches').BranchPoint>
  forkOf?: { id: string; messageId: string }
  /** extra models answering every question side by side (compare mode) */
  compareModels?: { providerId: string; model: string }[]
  createdAt: number
  updatedAt: number
}

export interface ConvParams { temperature?: number; topP?: number; maxTokens?: number; contextLength?: number }
export interface Folder { id: string; name: string; collapsed?: boolean }
export interface WebDavConfig { url: string; username: string; password: string; enabled: boolean; lastSync?: number }

export interface Persona {
  id: string
  name: string
  prompt: string
}

export interface PromptItem {
  id: string
  title: string
  content: string
}

export interface GalleryImage {
  id: string
  prompt: string
  url: string // data URL or remote URL
  createdAt: number
}

export interface McpServerConfig {
  id: string
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled: boolean
}

export interface Settings {
  language: 'system' | 'zh' | 'en'
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  temperature: number
  maxTokens: number
  contextLength: number // number of history messages sent
  proxy: string
  requestTimeout: number // seconds
  sendKey: 'Enter' | 'Ctrl+Enter'
  providers: ProviderConfig[]
  defaultProviderId: string
  defaultModel: string
  imageProviderId: string
  imageModel: string
  mcpServers: McpServerConfig[]
  toolsEnabled: boolean
  builtinTools: boolean // send builtin demo tools (time / calculator); off by default to save tokens
  autoTitle: boolean // summarize a short title after the first reply
  webSearch?: import('./websearch').WebSearchConfig
  stt?: import('./stt').SttConfig
  ocr?: OcrConfig
  /** attachments larger than this are rejected with a message (MB) */
  maxAttachmentMB?: number
  /** extracted text is cut at this many characters */
  maxAttachmentChars?: number
  readingWidth?: 'narrow' | 'standard' | 'wide'
  contextWindows?: import('./usage').ContextWindow[]
  codeLineNumbers: boolean
  codeCollapseLines: number // collapse code blocks longer than this (0 = never)
  topP: number
  retries: number
  retryBaseMs: number
  showUsage: boolean
  prices: import('./usage').Price[]
  webdav: WebDavConfig
  globalShortcut: string
  tray: boolean
  launchAtLogin: boolean
  autoCheckUpdate: boolean
  onboarded: boolean
  /** Settings > General > Developer mode: allows F12 / DevTools in packaged builds (default off) */
  devMode?: boolean
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}

/** image OCR (tesseract.js); off by default, language data is downloaded on demand */
export interface OcrConfig { enabled: boolean; langs: string[]; source: string }
