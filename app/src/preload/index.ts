import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ApiProfile, LLMEvent, LLMMessage } from '@shared/types'

const llmListeners = new Set<(e: LLMEvent) => void>()
ipcRenderer.on('llm:event', (_e, ev: LLMEvent) => {
  for (const l of llmListeners) l(ev)
})
const cmdListeners = new Set<(c: string) => void>()
ipcRenderer.on('app:command', (_e, c: string) => {
  for (const l of cmdListeners) l(c)
})
const maxListeners = new Set<(m: boolean) => void>()
ipcRenderer.on('win:maximized', (_e, m: boolean) => {
  for (const l of maxListeners) l(m)
})

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: (rel?: string) => ipcRenderer.invoke('app:openDataDir', rel),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    quit: () => ipcRenderer.invoke('app:quit'),
    onCommand: (cb: (c: string) => void) => {
      cmdListeners.add(cb)
      return () => cmdListeners.delete(cb)
    }
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb: (m: boolean) => void) => {
      maxListeners.add(cb)
      return () => maxListeners.delete(cb)
    }
  },
  fs: {
    readJSON: (rel: string) => ipcRenderer.invoke('fs:readJSON', rel),
    writeJSON: (rel: string, data: unknown, backup?: boolean) => ipcRenderer.invoke('fs:writeJSON', rel, data, backup),
    readBytes: (rel: string) => ipcRenderer.invoke('fs:readBytes', rel),
    writeBytes: (rel: string, data: Uint8Array) => ipcRenderer.invoke('fs:writeBytes', rel, data),
    list: (rel: string) => ipcRenderer.invoke('fs:list', rel),
    remove: (rel: string) => ipcRenderer.invoke('fs:remove', rel),
    exists: (rel: string) => ipcRenderer.invoke('fs:exists', rel)
  },
  secrets: {
    set: (id: string, key: string) => ipcRenderer.invoke('secrets:set', id, key),
    hint: (id: string) => ipcRenderer.invoke('secrets:hint', id),
    remove: (id: string) => ipcRenderer.invoke('secrets:remove', id)
  },
  llm: {
    start: (requestId: string, profile: ApiProfile, messages: LLMMessage[]) => ipcRenderer.invoke('llm:start', requestId, profile, messages),
    abort: (requestId: string) => ipcRenderer.invoke('llm:abort', requestId),
    models: (profile: ApiProfile) => ipcRenderer.invoke('llm:models', profile),
    test: (profile: ApiProfile) => ipcRenderer.invoke('llm:test', profile),
    onEvent: (cb: (e: LLMEvent) => void) => {
      llmListeners.add(cb)
      return () => llmListeners.delete(cb)
    }
  },
  dialog: {
    openFiles: (opts: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }) => ipcRenderer.invoke('dialog:openFiles', opts),
    saveFile: (defaultName: string, bytes: Uint8Array, filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('dialog:saveFile', defaultName, bytes, filters)
  },
  file: {
    pathOf: (f: File) => webUtils.getPathForFile(f)
  },
  archive: {
    export: (opts: { characterIds: string[] | null; includeSettings: boolean }) => ipcRenderer.invoke('archive:export', opts),
    pick: () => ipcRenderer.invoke('archive:pick'),
    inspect: (bytes: Uint8Array) => ipcRenderer.invoke('archive:inspect', bytes),
    apply: (token: string, opts: unknown) => ipcRenderer.invoke('archive:apply', token, opts),
    discard: (token: string) => ipcRenderer.invoke('archive:discard', token)
  },
  dev: {
    capture: (file: string) => ipcRenderer.invoke('dev:capture', file)
  }
}

contextBridge.exposeInMainWorld('yt', api)
