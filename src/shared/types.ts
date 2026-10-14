export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'ollama'

export interface ProviderConfig {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  baseURL: string
  models: string[]
}

export interface Attachment {
  name: string
  text: string
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
  createdAt: number
  updatedAt: number
}

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
  codeLineNumbers: boolean
  codeCollapseLines: number // collapse code blocks longer than this (0 = never)
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON schema
}
