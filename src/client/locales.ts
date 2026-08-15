/** Localized copy owned by the session bridge surface. */

export const NS = 'dsh-sessions'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.copySessionId': '复制会话 ID',
  'menu.copied': '已复制',
  'settings.title': '会话引用',
  'settings.description': '选择新会话可以通过 @ 或 session id 引用哪些历史会话。',
  'settings.scopeLabel': '可选范围',
  'settings.scope.workspace': '仅当前工作区',
  'settings.scope.workspaceHint': '只能引用 cwd 相同的历史会话。',
  'settings.scope.all': '所有可见会话',
  'settings.scope.allHint': '可引用本机 dsh 可见的全部历史会话。',
  'settings.unavailable': '设置服务不可用',
} satisfies Record<string, string>

/** The session bridge namespace key union. */
export type SessionKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'menu.copySessionId': 'Copy session ID',
  'menu.copied': 'Copied',
  'settings.title': 'Session references',
  'settings.description': 'Choose which past sessions a new session can reference with @ or a session id.',
  'settings.scopeLabel': 'Reference scope',
  'settings.scope.workspace': 'Current workspace only',
  'settings.scope.workspaceHint': 'Only past sessions with the same cwd can be referenced.',
  'settings.scope.all': 'All visible sessions',
  'settings.scope.allHint': 'Every past session visible to this dsh installation can be referenced.',
  'settings.unavailable': 'Settings service unavailable',
} satisfies Record<SessionKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-sessions': SessionKey
  }
}
