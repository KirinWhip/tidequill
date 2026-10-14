import type { Conversation, GalleryImage, Persona, PromptItem, Settings } from './types'

export interface KV {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

export class MemoryKV implements KV {
  data = new Map<string, string>()
  async get(k: string) { const v = this.data.get(k); return v === undefined ? undefined : JSON.parse(v) }
  async set(k: string, v: any) { this.data.set(k, JSON.stringify(v)) }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export function defaultSettings(): Settings {
  return {
    language: 'system', theme: 'system', fontSize: 14, temperature: 0.7, maxTokens: 4096, contextLength: 20,
    proxy: '', requestTimeout: 60, sendKey: 'Enter',
    providers: [
      { id: 'openai', name: 'OpenAI', type: 'openai', apiKey: '', baseURL: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'] },
      { id: 'anthropic', name: 'Claude', type: 'anthropic', apiKey: '', baseURL: 'https://api.anthropic.com', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'] },
      { id: 'gemini', name: 'Gemini', type: 'gemini', apiKey: '', baseURL: 'https://generativelanguage.googleapis.com', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
      { id: 'ollama', name: 'Ollama', type: 'ollama', apiKey: '', baseURL: 'http://localhost:11434', models: ['llama3.1', 'qwen2.5'] },
      { id: 'deepseek', name: 'DeepSeek', type: 'openai', apiKey: '', baseURL: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
      { id: 'xai', name: 'xAI Grok', type: 'openai', apiKey: '', baseURL: 'https://api.x.ai/v1', models: ['grok-4', 'grok-3-mini'] },
      { id: 'qwen', name: 'Qwen', type: 'openai', apiKey: '', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-vl-max'] },
    ],
    defaultProviderId: 'openai', defaultModel: 'gpt-4o-mini',
    imageProviderId: 'openai', imageModel: 'dall-e-3',
    mcpServers: [], toolsEnabled: true, codeLineNumbers: false, codeCollapseLines: 30,
  }
}

/** default personas/prompts are built from a localized string table */
export type DefaultsDict = Record<string, string>
export function defaultPersonas(d: DefaultsDict): Persona[] {
  return ['default', 'translator', 'coder'].map(k => ({ id: k, name: d[`defaultPersona_${k}`], prompt: d[`defaultPersona_${k}_prompt`] }))
}
export function defaultPrompts(d: DefaultsDict): PromptItem[] {
  return ['summary', 'polish', 'explain'].map(k => ({ id: k, title: d[`defaultPrompt_${k}`], content: d[`defaultPrompt_${k}_c`] }))
}

export class Storage {
  constructor(private kv: KV) {}

  async loadSettings(): Promise<Settings> {
    const s = await this.kv.get('settings')
    const d = defaultSettings()
    if (!s) return d
    // merge new defaults in, keep user providers
    return { ...d, ...s, providers: s.providers?.length ? s.providers : d.providers }
  }
  saveSettings(s: Settings) { return this.kv.set('settings', s) }

  async listConversations(): Promise<Conversation[]> {
    const list: Conversation[] = (await this.kv.get('conversations')) || []
    return sortConversations(list)
  }
  saveConversations(list: Conversation[]) { return this.kv.set('conversations', list) }
  async upsertConversation(c: Conversation) {
    const list = await this.listConversations()
    const i = list.findIndex(x => x.id === c.id)
    if (i >= 0) list[i] = c; else list.push(c)
    await this.saveConversations(list)
  }
  async deleteConversation(id: string) {
    await this.saveConversations((await this.listConversations()).filter(c => c.id !== id))
  }

  async loadPersonas(d: DefaultsDict): Promise<Persona[]> { return (await this.kv.get('personas')) || defaultPersonas(d) }
  savePersonas(p: Persona[]) { return this.kv.set('personas', p) }
  async loadPrompts(d: DefaultsDict): Promise<PromptItem[]> { return (await this.kv.get('prompts')) || defaultPrompts(d) }
  savePrompts(p: PromptItem[]) { return this.kv.set('prompts', p) }
  async loadGallery(): Promise<GalleryImage[]> { return (await this.kv.get('gallery')) || [] }
  saveGallery(g: GalleryImage[]) { return this.kv.set('gallery', g) }
}

export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.updatedAt - a.updatedAt)
}

export function searchConversations(list: Conversation[], q: string): Conversation[] {
  const s = q.trim().toLowerCase()
  if (!s) return list
  return list.filter(c => c.title.toLowerCase().includes(s) || c.messages.some(m => m.content.toLowerCase().includes(s)))
}

export interface MdLabels { model: string; attachment: string }
export function conversationToMarkdown(c: Conversation, l: MdLabels = { model: 'Model', attachment: 'Attachment' }): string {
  const lines = [`# ${c.title}`, '', `> ${l.model}: ${c.model} · ${new Date(c.createdAt).toISOString()}`, '']
  if (c.systemPrompt) lines.push('## System', '', c.systemPrompt, '')
  for (const m of c.messages) {
    if (m.role === 'tool') continue
    lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`, '', m.content, '')
    for (const a of m.attachments || []) lines.push(`*${l.attachment}: ${a.name}*`, '')
  }
  return lines.join('\n')
}

export function exportJSON(list: Conversation[]): string {
  return JSON.stringify({ app: 'chatbox-clone', version: 1, conversations: list }, null, 2)
}

export function importJSON(text: string): Conversation[] {
  const j = JSON.parse(text)
  const arr = Array.isArray(j) ? j : j.conversations
  if (!Array.isArray(arr)) throw new Error('Invalid file')
  return arr.filter(c => c && c.id && Array.isArray(c.messages)).map(c => ({ pinned: false, systemPrompt: '', ...c }))
}

/** parse a markdown export back into a conversation (best effort) */
export function importMarkdown(text: string): Conversation {
  const title = /^# (.+)$/m.exec(text)?.[1] || 'Imported'
  const parts = text.split(/^## (User|Assistant|System)\s*$/m)
  const now = Date.now()
  const c: Conversation = { id: uid(), title, messages: [], providerId: '', model: '', systemPrompt: '', pinned: false, createdAt: now, updatedAt: now }
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1].trim()
    if (parts[i] === 'System') c.systemPrompt = body
    else c.messages.push({ id: uid(), role: parts[i] === 'User' ? 'user' : 'assistant', content: body, createdAt: now })
  }
  return c
}
