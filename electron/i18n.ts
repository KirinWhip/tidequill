/** strings shown by the main process (native dialogs) */
export const mainStrings = {
  zh: {
    toolTitle: '工具调用确认', toolMessage: '模型请求调用工具：{name}', toolDetail: '参数：\n{args}\n\n是否允许执行？',
    allow: '允许', deny: '拒绝', always: '始终允许此工具（不再询问）', denied: '用户拒绝了此次工具调用。',
  },
  en: {
    toolTitle: 'Confirm tool call', toolMessage: 'The model wants to call tool: {name}', toolDetail: 'Arguments:\n{args}\n\nAllow it to run?',
    allow: 'Allow', deny: 'Deny', always: 'Always allow this tool (don\'t ask again)', denied: 'The user denied this tool call.',
  },
}
export type MainLang = keyof typeof mainStrings
