/** Localized copy owned by the session bridge surface. */

export const NS = 'dsh-sessions'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu.copySessionId': '复制会话 ID',
  'menu.copied': '已复制',
  'settings.title': '引注',
  'settings.description': '选择 @ 可以引用哪些历史会话。选区引注和产物清单不经过这项设置。',
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
  'quote.failed': '添加失败，请重试',
  'quote.chip': '引用 {index}',
  'quote.count': '{count} 条注释',
  'quote.expandBar': '展开注释列表',
  'quote.collapseBar': '收起注释列表',
  'quote.expand': '展开引用',
  'quote.collapse': '收起引用',
  'quote.remove': '移除 {label}',
  'quote.truncated': '…（已截断）',
  'quote.commentPlaceholder': '添加评论…',
  'quote.commentLabel': '评论',
  'quote.commentCancel': '取消',
  'quote.commentSave': '保存',
  'quote.commentSaveFailed': '保存失败，请重试',
  'quote.bubbleHasComment': '{label}，已有评论',
  'artifacts.label': '产物',
  'artifacts.open': '打开',
  'artifacts.copyPath': '复制路径',
  'artifacts.reveal.macos': '在 Finder 中显示',
  'artifacts.reveal.windows': '在资源管理器中显示',
  'artifacts.reveal.linux': '在文件管理器中显示',
  'artifacts.copied': '路径已复制',
  'artifacts.copyFailed': '复制失败，请重试',
  'artifacts.openFailed': '打开失败',
  'artifacts.revealFailed': '无法打开所在文件夹',
} satisfies Record<string, string>

/** The session bridge namespace key union. */
export type SessionKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'menu.copySessionId': 'Copy session ID',
  'menu.copied': 'Copied',
  'settings.title': 'Cite',
  'settings.description': 'Choose which past sessions @ can cite. In-chat quotes and produced files are not affected.',
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
  'quote.failed': 'Could not add; try again',
  'quote.chip': 'Quote {index}',
  'quote.count': '{count} comments',
  'quote.expandBar': 'Show comments',
  'quote.collapseBar': 'Hide comments',
  'quote.expand': 'Expand quote',
  'quote.collapse': 'Collapse quote',
  'quote.remove': 'Remove {label}',
  'quote.truncated': '… (truncated)',
  'quote.commentPlaceholder': 'Add comment…',
  'quote.commentLabel': 'Comment',
  'quote.commentCancel': 'Cancel',
  'quote.commentSave': 'Save',
  'quote.commentSaveFailed': 'Could not save; try again',
  'quote.bubbleHasComment': '{label}, commented',
  'artifacts.label': 'Produced',
  'artifacts.open': 'Open',
  'artifacts.copyPath': 'Copy path',
  'artifacts.reveal.macos': 'Reveal in Finder',
  'artifacts.reveal.windows': 'Show in Explorer',
  'artifacts.reveal.linux': 'Show in file manager',
  'artifacts.copied': 'Path copied',
  'artifacts.copyFailed': 'Copy failed, please retry',
  'artifacts.openFailed': 'Open failed',
  'artifacts.revealFailed': 'Could not open the containing folder',
} satisfies Record<SessionKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-sessions': SessionKey
  }
}
