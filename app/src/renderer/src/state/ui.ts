import { create } from 'zustand'
import type { ReactNode } from 'react'
import { audio } from '../audio/engine'

export interface Toast {
  id: number
  kind: 'info' | 'ok' | 'warn' | 'error'
  text: string
  detail?: string
  leaving?: boolean
  action?: { label: string; run: () => void }
}

export interface ConfirmReq {
  title: string
  body?: ReactNode
  okText?: string
  cancelText?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

interface UIState {
  toasts: Toast[]
  confirmReq: ConfirmReq | null
  modal: { key: string; node: ReactNode } | null
  dropActive: boolean
  toast(kind: Toast['kind'], text: string, detail?: string, action?: Toast['action']): void
  dismiss(id: number): void
  confirm(o: Omit<ConfirmReq, 'resolve'>): Promise<boolean>
  closeConfirm(ok: boolean): void
  openModal(key: string, node: ReactNode): void
  closeModal(): void
  setDrop(v: boolean): void
}

let seq = 1
export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  confirmReq: null,
  modal: null,
  dropActive: false,
  toast(kind, text, detail, action) {
    const id = seq++
    if (kind === 'error') audio.error()
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text, detail, action }] })
    window.setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : action ? 6000 : 3600)
  },
  dismiss(id) {
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })
    window.setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 260)
  },
  confirm(o) {
    return new Promise((resolve) => set({ confirmReq: { ...o, resolve } }))
  },
  closeConfirm(ok) {
    const r = get().confirmReq
    set({ confirmReq: null })
    r?.resolve(ok)
  },
  openModal(key, node) {
    set({ modal: { key, node } })
  },
  closeModal() {
    set({ modal: null })
  },
  setDrop(v) {
    if (get().dropActive !== v) set({ dropActive: v })
  }
}))

export const toast = (kind: Toast['kind'], text: string, detail?: string, action?: Toast['action']) => useUI.getState().toast(kind, text, detail, action)
export const confirmDialog = (o: Omit<ConfirmReq, 'resolve'>) => useUI.getState().confirm(o)
