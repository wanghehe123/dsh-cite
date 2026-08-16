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
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.unsaved': '未保存',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃修改',
  'settings.saveFailed': '本部署没有接受这些值，已保留供你修改。',
  'quote.button': '添加到对话',
  'quote.added': '已添加',
  'quote.failed': '添加失败，请重试',
  'quote.chip': '引用 {index}',
  'quote.count': '已引用 {count} 段',
  'quote.expand': '展开引用',
  'quote.collapse': '收起引用',
  'quote.remove': '移除 {label}',
  'quote.truncated': '…（已截断）',
  'quote.commentPlaceholder': '添加可选评论…',
  'quote.commentLabel': '评论',
  'quote.confirm': '添加为引用 {index}',
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
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.unsaved': 'Unsaved',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.discard': 'Discard',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'quote.button': 'Add to conversation',
  'quote.added': 'Added',
  'quote.failed': 'Could not add; try again',
  'quote.chip': 'Quote {index}',
  'quote.count': 'Quoted: {count}',
  'quote.expand': 'Expand quote',
  'quote.collapse': 'Collapse quote',
  'quote.remove': 'Remove {label}',
  'quote.truncated': '… (truncated)',
  'quote.commentPlaceholder': 'Add optional comment…',
  'quote.commentLabel': 'Comment',
  'quote.confirm': 'Add as quote {index}',
} satisfies Record<SessionKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-sessions': SessionKey
  }
}
