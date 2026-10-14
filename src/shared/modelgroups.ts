/** Round 3 · B8: group a provider's model list by family, newest first; older models are collapsed in the dropdown */

const FAMILIES: [string, RegExp][] = [
  ['Claude Opus', /claude-(?:\d[\d.-]*-)?opus/i], ['Claude Sonnet', /claude-(?:\d[\d.-]*-)?sonnet/i], ['Claude Haiku', /claude-(?:\d[\d.-]*-)?haiku/i], ['Claude', /claude|mythos|fable/i],
  ['GPT', /^(?:chatgpt|gpt)-/i], ['OpenAI o', /^o\d/i], ['OpenAI', /^(?:dall-e|whisper|tts|text-embedding|davinci|babbage|omni-moderation|codex)/i],
  ['Gemini', /gemini/i], ['Gemma', /gemma/i], ['DeepSeek', /deepseek/i], ['Grok', /grok/i], ['Qwen', /qwen|qwq/i], ['Llama', /llama/i],
  ['Mistral', /mistral|mixtral|codestral|ministral|magistral/i], ['GLM', /glm/i], ['Kimi', /kimi|moonshot/i], ['Doubao', /doubao/i], ['Phi', /phi/i],
]
export function modelFamily(m: string): string {
  const name = m.split('/').pop() || m
  for (const [f, re] of FAMILIES) if (re.test(name)) return f
  return ''
}
/** version key: numbers in the name (dates like 20250929 / 2024-08-06 separately as a tie-breaker) */
export function versionKey(m: string): { nums: number[]; date: number; latest: boolean } {
  const name = (m.split('/').pop() || m).toLowerCase()
  let date = 0
  const d8 = /(20\d{2})-?(\d{2})-?(\d{2})/.exec(name)
  const rest = d8 ? name.replace(d8[0], '') : name
  if (d8) date = +(d8[1] + d8[2] + d8[3])
  const nums = (rest.match(/\d+(?:\.\d+)?/g) || []).flatMap(x => x.split('.').map(Number)).filter(n => n < 1000)
  return { nums, date, latest: /latest/.test(name) }
}
export function compareNewest(a: string, b: string): number {
  const x = versionKey(a), y = versionKey(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const p = x.nums[i] ?? -1, q = y.nums[i] ?? -1
    if (p !== q) return q - p
  }
  if (x.latest !== y.latest) return x.latest ? -1 : 1
  if (x.date !== y.date) return y.date - x.date
  return a.localeCompare(b)
}
export interface ModelGroup { family: string; recent: string[]; older: string[] }
/** families keep the order in which they first appear in the list; within a family newest first; the first `keep`
 *  models (and the current one) are "recent", the rest go under 显示更早的模型 */
export function groupModels(models: string[], current = '', keep = 3): ModelGroup[] {
  const groups = new Map<string, string[]>()
  for (const m of models) { const f = modelFamily(m); if (!groups.has(f)) groups.set(f, []); groups.get(f)!.push(m) }
  return [...groups.entries()].map(([family, list]) => {
    // unknown family: names carry no comparable version, keep the provider's order and never collapse
    if (!family) return { family, recent: [...list], older: [] }
    const sorted = [...list].sort(compareNewest)
    const recent = sorted.slice(0, keep), older = sorted.slice(keep)
    if (current && older.includes(current)) { older.splice(older.indexOf(current), 1); recent.push(current) }
    return { family, recent, older }
  })
}
