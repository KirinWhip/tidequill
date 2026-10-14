/** in-conversation find: positions of all case-insensitive matches of `q` in `text` */
export function findAll(text: string, q: string): number[] {
  if (!q) return []
  const hay = text.toLocaleLowerCase(), needle = q.toLocaleLowerCase()
  // toLocaleLowerCase can change the length for a few characters (e.g. 'İ'); fall back to exact matching then
  const same = hay.length === text.length
  const H = same ? hay : text, N = same ? needle : q
  const out: number[] = []
  for (let i = H.indexOf(N); i >= 0; i = H.indexOf(N, i + Math.max(1, N.length))) out.push(i)
  return out
}
/** next index in a ring of `total` items */
export const step = (cur: number, total: number, dir: 1 | -1) => total ? (cur + dir + total) % total : -1
