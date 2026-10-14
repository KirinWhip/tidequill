import { createContext, useContext } from 'react'
import { zhCN, type Dict } from './locales/zh-CN'
import { en } from './locales/en'
export type { Dict }
export const dicts = { zh: zhCN, en }
export type Lang = keyof typeof dicts
export function resolveLang(setting: 'system' | 'zh' | 'en' | undefined, systemLocale: string): Lang {
  if (setting === 'zh' || setting === 'en') return setting
  return /^zh/i.test(systemLocale || '') ? 'zh' : 'en'
}
export const I18n = createContext<Dict>(zhCN)
export const useT = () => useContext(I18n)
