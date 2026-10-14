/** strings shown by the main process (native dialogs) */
export const mainStrings = {
  zh: {
    toolTitle: '工具调用确认', toolMessage: '模型请求调用工具：{name}', toolDetail: '参数：\n{args}\n\n是否允许执行？',
    toolSource: '来源：{source}',
    allow: '允许', deny: '拒绝', always: '始终允许（仅限 {source} 的此工具，不再询问）', denied: '用户拒绝了此次工具调用。',
    trayShow: '显示/隐藏窗口', trayNew: '新对话', trayQuit: '退出',
  },
  en: {
    toolTitle: 'Confirm tool call', toolMessage: 'The model wants to call tool: {name}', toolDetail: 'Arguments:\n{args}\n\nAllow it to run?',
    toolSource: 'Source: {source}',
    allow: 'Allow', deny: 'Deny', always: 'Always allow this tool from {source} (don\'t ask again)', denied: 'The user denied this tool call.',
    trayShow: 'Show/Hide window', trayNew: 'New chat', trayQuit: 'Quit',
  },
}
export type MainLang = keyof typeof mainStrings
