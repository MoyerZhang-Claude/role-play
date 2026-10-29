import type { ApiProfile, LLMEvent, LLMMessage, ArchiveSummary, ApplyOptions } from '../shared/types'

export interface AppInfo {
  version: string
  dataDir: string
  dataFallback: boolean
  isDev: boolean
  displayHz: number
  scaleFactor: number
  encryption: boolean
  electron: string
  chrome: string
}

export interface FileEntry {
  name: string
  dir: boolean
  mtime: number
  size: number
}

export interface YtApi {
  app: {
    info(): Promise<AppInfo>
    openDataDir(rel?: string): Promise<string>
    openExternal(url: string): Promise<void>
    quit(): Promise<void>
    onCommand(cb: (cmd: string) => void): () => void
  }
  win: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximized(cb: (m: boolean) => void): () => void
  }
  fs: {
    readJSON<T = unknown>(rel: string): Promise<T | null>
    writeJSON(rel: string, data: unknown, backup?: boolean): Promise<void>
    readBytes(rel: string): Promise<Uint8Array | null>
    writeBytes(rel: string, data: Uint8Array): Promise<void>
    list(rel: string): Promise<FileEntry[]>
    remove(rel: string): Promise<void>
    exists(rel: string): Promise<boolean>
  }
  secrets: {
    set(id: string, key: string): Promise<void>
    hint(id: string): Promise<string | null>
    remove(id: string): Promise<void>
  }
  llm: {
    start(requestId: string, profile: ApiProfile, messages: LLMMessage[]): Promise<boolean>
    abort(requestId: string): Promise<void>
    models(profile: ApiProfile): Promise<string[]>
    test(profile: ApiProfile): Promise<{ ok: boolean; ms?: number; text?: string; error?: string }>
    onEvent(cb: (e: LLMEvent) => void): () => void
  }
  dialog: {
    openFiles(opts: { title?: string; filters?: { name: string; extensions: string[] }[]; multi?: boolean }): Promise<{ name: string; bytes: Uint8Array }[]>
    saveFile(defaultName: string, bytes: Uint8Array, filters?: { name: string; extensions: string[] }[]): Promise<string | null>
  }
  file: {
    pathOf(f: File): string
  }
  archive: {
    export(opts: { characterIds: string[] | null; includeSettings: boolean }): Promise<{ path: string; size: number; counts: { characters: number; chats: number; worldbooks: number } } | null>
    pick(): Promise<ArchiveSummary | null>
    inspect(bytes: Uint8Array): Promise<ArchiveSummary>
    apply(token: string, opts: ApplyOptions): Promise<{ characters: number; chats: number; worldbooks: number; skipped: number; backup: string }>
    discard(token: string): Promise<void>
  }
  dev: {
    capture(file: string): Promise<string | null>
  }
}

declare global {
  interface Window {
    yt: YtApi
  }
}
