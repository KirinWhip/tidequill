import type { Conversation, Message } from './types'

/** In-place branches: at message position `pos` several alternative tails (messages[pos..]) can exist.
 *  Each variant also remembers the branch points nested inside it (positions > pos). */
export interface Variant { messages: Message[]; branches: Record<string, BranchPoint> }
export interface BranchPoint { variants: Variant[]; active: number }

const nested = (b: Record<string, BranchPoint> | undefined, pos: number, keepBelow: boolean) =>
  Object.fromEntries(Object.entries(b || {}).filter(([k]) => keepBelow ? +k < pos : +k > pos))

/** replace messages[pos..] with `newTail`, saving the current tail as a variant at `pos` */
export function branchAt(c: Conversation, pos: number, newTail: Message[]): Conversation {
  const branches = c.branches || {}
  const cur: Variant = { messages: c.messages.slice(pos), branches: nested(branches, pos, false) }
  const bp = branches[pos] ? { ...branches[pos], variants: [...branches[pos].variants] } : { variants: [], active: 0 }
  if (bp.variants.length) bp.variants[bp.active] = cur; else bp.variants.push(cur)
  bp.variants.push({ messages: newTail, branches: {} })
  bp.active = bp.variants.length - 1
  return { ...c, messages: [...c.messages.slice(0, pos), ...newTail], branches: { ...nested(branches, pos, true), [pos]: bp } }
}

/** switch the branch at `pos` to variant `idx` */
export function switchBranch(c: Conversation, pos: number, idx: number): Conversation {
  const bp = c.branches?.[pos]
  if (!bp || idx < 0 || idx >= bp.variants.length || idx === bp.active) return c
  const variants = [...bp.variants]
  variants[bp.active] = { messages: c.messages.slice(pos), branches: nested(c.branches, pos, false) }
  const target = variants[idx]
  return { ...c, messages: [...c.messages.slice(0, pos), ...target.messages], branches: { ...nested(c.branches, pos, true), ...target.branches, [pos]: { variants, active: idx } } }
}

/** position index -> branch info for message at that index (only first message of a tail carries the switcher) */
export function branchInfo(c: Conversation, pos: number): { index: number; total: number } | null {
  const bp = c.branches?.[pos]
  return bp && bp.variants.length > 1 ? { index: bp.active, total: bp.variants.length } : null
}

/** fork: new conversation with messages up to and including `msgId` */
export function forkConversation(c: Conversation, msgId: string, newId: string, title: string): Conversation {
  const i = c.messages.findIndex(m => m.id === msgId)
  const now = Date.now()
  return { ...c, id: newId, title, messages: c.messages.slice(0, i + 1).map(m => ({ ...m })), branches: {}, pinned: false, forkOf: { id: c.id, messageId: msgId }, createdAt: now, updatedAt: now }
}
