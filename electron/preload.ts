import { contextBridge, ipcRenderer } from 'electron'

const httpListeners = new Map<string, (ev: any) => void>()
ipcRenderer.on('http:event', (_e, id: string, ev: any) => httpListeners.get(id)?.(ev))

const api = {
  kvGet: (k: string) => ipcRenderer.invoke('kv:get', k),
  kvSet: (k: string, v: any) => ipcRenderer.invoke('kv:set', k, v),
  secureStatus: () => ipcRenderer.invoke('secure:status'),
  setProxy: (p: string) => ipcRenderer.invoke('proxy:set', p),
  locale: () => ipcRenderer.invoke('app:locale'),
  setLanguage: (l: string) => ipcRenderer.invoke('app:setLanguage', l),
  saveFile: (name: string, content: string) => ipcRenderer.invoke('file:save', name, content),
  openFile: (exts: string[]) => ipcRenderer.invoke('file:open', exts),
  syncTools: (servers: any[]) => ipcRenderer.invoke('tools:sync', servers),
  toolStatus: () => ipcRenderer.invoke('tools:status'),
  listTools: () => ipcRenderer.invoke('tools:list'),
  callTool: (name: string, args: any) => ipcRenderer.invoke('tools:call', name, args),
  toolAllowlist: () => ipcRenderer.invoke('tools:allowlist'),
  revokeTool: (name: string) => ipcRenderer.invoke('tools:revoke', name),
  openPluginDir: () => ipcRenderer.invoke('plugins:openDir'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  applySystem: (o: any) => ipcRenderer.invoke('system:apply', o),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  about: () => ipcRenderer.invoke('app:about'),
  notices: () => ipcRenderer.invoke('app:notices'),
  openRepo: () => ipcRenderer.invoke('app:openRepo'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  exportPdf: (name: string) => ipcRenderer.invoke('pdf:export', name),
  onCommand: (cb: (cmd: string) => void) => { ipcRenderer.removeAllListeners('app:command'); ipcRenderer.on('app:command', (_e, c) => cb(c)) },
  version: () => ipcRenderer.invoke('app:version'),
  httpStart: (id: string, req: any, onEvent: (ev: any) => void) => { httpListeners.set(id, onEvent); ipcRenderer.send('http:start', id, req) },
  httpAbort: (id: string) => ipcRenderer.send('http:abort', id),
  httpDone: (id: string) => { httpListeners.delete(id) },
}
contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
