/** Main-process side of the plugin host: request/response over the utility process' message port,
 *  per-call timeout, automatic restart after a crash or a hung call. */
export interface HostProc { post(m: any): void; onMessage(cb: (m: any) => void): void; onExit(cb: (code: number) => void): void; kill(): void; pid?: number }
export type Spawn = () => HostProc

export class PluginHostClient {
  private proc: HostProc | null = null
  private seq = 0
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; timer: any }>()
  private lastLoad: { path: string; sha256: string }[] = []
  restarts = 0
  constructor(private spawn: Spawn, private timeoutMs = 60_000) {}

  get pid() { return this.proc?.pid }
  private ensure(): HostProc {
    if (this.proc) return this.proc
    const p = this.spawn(); this.proc = p
    p.onMessage(m => { const w = this.pending.get(m?.id); if (!w) return; this.pending.delete(m.id); clearTimeout(w.timer); w.res(m) })
    p.onExit(code => {
      if (this.proc !== p) return
      this.proc = null; this.restarts++
      for (const [id, w] of this.pending) { clearTimeout(w.timer); w.rej(new Error(`plugin host exited (code ${code})`)); this.pending.delete(id) }
    })
    return p
  }
  private request(m: any, timeoutMs = this.timeoutMs): Promise<any> {
    const p = this.ensure(); const id = ++this.seq
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`plugin call timed out after ${Math.round(timeoutMs / 1000)} s; plugin host restarted`)); this.restart() }, timeoutMs)
      this.pending.set(id, { res, rej, timer })
      p.post({ ...m, id })
    })
  }
  private restart() { const p = this.proc; this.proc = null; this.restarts++; try { p?.kill() } catch { /* ignore */ } }

  async load(files: { path: string; sha256: string }[]) {
    this.lastLoad = files
    if (!files.length) { this.stop(); return { plugins: [], errors: [] } }
    return this.request({ op: 'load', files }, 30_000)
  }
  async call(file: string, tool: string, args: any): Promise<string> {
    if (!this.proc) await this.request({ op: 'load', files: this.lastLoad }, 30_000) // first call after a crash / restart: reload trusted plugins
    const r = await this.request({ op: 'call', file, tool, args })
    if (!r.ok) throw new Error(r.error)
    return r.result
  }
  stop() { const p = this.proc; this.proc = null; try { p?.kill() } catch { /* ignore */ } }
}
