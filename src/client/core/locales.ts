/**
 * Locale bundles for the dsh-task-runner UI. zh is the source of truth for
 * the key set; en is checked complete against it (both dictionaries are
 * `Record<TaskRunnerLocaleKey, string>`, so a missing or extra key in either
 * is a compile error (the official registration enforces bilingual balance).
 * @module @xiaoso/dsh-task-runner/client/locales
 */

/** Locale dictionary namespace of this plugin's UI copy. */
export const NS = 'task-runner' as const

export type TaskRunnerLocaleKey =
  | 'run'
  | 'runTaskHint'
  | 'selectTask'
  | 'groupGlobal'
  | 'groupWorkspace'
  | 'searchPlaceholder'
  | 'editConfig'
  | 'noVisibleTasks'
  | 'started'
  | 'runFailed'
  | 'config'
  | 'heroAddWorkspace'
  | 'heroPathPlaceholder'
  | 'heroCreate'
  | 'heroSearchWorkspace'
  | 'heroNoWorkspaces'
  | 'configTitle'
  | 'fieldName'
  | 'fieldDescription'
  | 'fieldDescriptionHint'
  | 'fieldType'
  | 'fieldScope'
  | 'fieldWorkspace'
  | 'fieldPrompt'
  | 'fieldPromptHint'
  | 'fieldCommand'
  | 'fieldCommandHint'
  | 'fieldNotifyLlm'
  | 'fieldNotifyLlmHint'
  | 'typeLlm'
  | 'typeCommand'
  | 'scopeGlobal'
  | 'scopeWorkspace'
  | 'workspacePlaceholder'
  | 'newTaskName'
  | 'btnCancel'
  | 'btnSave'
  | 'savedText'
  | 'btnAdd'
  | 'btnDuplicate'
  | 'btnDelete'
  | 'deleteConfirmTitle'
  | 'deleteConfirmBody'
  | 'deleteConfirmYes'
  | 'deleteConfirmNo'
  | 'exposeToolToLlm'
  | 'exposeToolToLlmHint'
  | 'saveFailed'
  | 'emptyList'
  | 'emptyListHint'

/** Simplified Chinese copy. */
export const zh: Record<TaskRunnerLocaleKey, string> = {
  run: '运行',
  runTaskHint: '在当前工作区运行任务「{name}」',
  selectTask: '选择任务',
  groupGlobal: '全局',
  groupWorkspace: '当前工作区',
  searchPlaceholder: '搜索任务…',
  editConfig: '编辑配置…',
  noVisibleTasks: '没有可见任务',
  started: '已启动 {id}',
  runFailed: '运行失败：{message}',
  config: '运行设置',
  heroAddWorkspace: '添加工作区…',
  heroPathPlaceholder: '输入工作区路径',
  heroCreate: '创建',
  heroSearchWorkspace: '搜索工作区…',
  heroNoWorkspaces: '没有匹配的工作区',
  configTitle: '运行设置',
  fieldName: '名称',
  fieldDescription: '描述',
  fieldDescriptionHint: '说明这个任务是做什么的（可选）',
  fieldType: '类型',
  fieldScope: '作用域',
  fieldWorkspace: '工作区',
  fieldPrompt: 'Prompt',
  fieldPromptHint: '运行后自动填入输入框并发送',
  fieldCommand: '命令',
  fieldCommandHint: '在任务工作区执行的 Shell 命令',
  fieldNotifyLlm: '完成后通知 LLM',
  fieldNotifyLlmHint: '命令结束后把结果告知 LLM',
  typeLlm: 'LLM 任务',
  typeCommand: '命令任务',
  scopeGlobal: '全局',
  scopeWorkspace: '工作区',
  workspacePlaceholder: '选择工作区…',
  newTaskName: '新任务',
  btnCancel: '取消',
  btnSave: '保存',
  savedText: '已保存',
  btnAdd: '新增',
  btnDuplicate: '复制',
  btnDelete: '删除',
  deleteConfirmTitle: '删除任务',
  deleteConfirmBody: '确定删除「{name}」？',
  deleteConfirmYes: '删除',
  deleteConfirmNo: '取消',
  exposeToolToLlm: '暴露任务管理工具给 LLM',
  exposeToolToLlmHint: '开启后，LLM 可通过 task_runner_config 工具查看和修改任务',
  saveFailed: '保存失败：{message}',
  emptyList: '暂无任务',
  emptyListHint: '点击上方 + 新建任务',
}

/** English copy. */
export const en: Record<TaskRunnerLocaleKey, string> = {
  run: 'Run',
  runTaskHint: 'Run task "{name}" in the current workspace',
  selectTask: 'Select a task',
  groupGlobal: 'Global',
  groupWorkspace: 'Current workspace',
  searchPlaceholder: 'Search tasks…',
  editConfig: 'Edit configurations…',
  noVisibleTasks: 'No visible tasks',
  started: 'Started {id}',
  runFailed: 'Run failed: {message}',
  config: 'Run configurations',
  heroAddWorkspace: 'Add workspace…',
  heroPathPlaceholder: 'Enter a workspace path',
  heroCreate: 'Create',
  heroSearchWorkspace: 'Search workspaces…',
  heroNoWorkspaces: 'No matching workspaces',
  configTitle: 'Run configurations',
  fieldName: 'Name',
  fieldDescription: 'Description',
  fieldDescriptionHint: 'What this task does (optional)',
  fieldType: 'Type',
  fieldScope: 'Scope',
  fieldWorkspace: 'Workspace',
  fieldPrompt: 'Prompt',
  fieldPromptHint: 'Fills the composer and submits when run',
  fieldCommand: 'Command',
  fieldCommandHint: 'Shell command run in the task workspace',
  fieldNotifyLlm: 'Notify the LLM when finished',
  fieldNotifyLlmHint: 'Reports the result to the LLM after the command ends',
  typeLlm: 'LLM task',
  typeCommand: 'Command task',
  scopeGlobal: 'Global',
  scopeWorkspace: 'Workspace',
  workspacePlaceholder: 'Select a workspace…',
  newTaskName: 'New task',
  btnCancel: 'Cancel',
  btnSave: 'Save',
  savedText: 'Saved',
  btnAdd: 'New',
  btnDuplicate: 'Duplicate',
  btnDelete: 'Delete',
  deleteConfirmTitle: 'Delete task',
  deleteConfirmBody: 'Delete "{name}"?',
  deleteConfirmYes: 'Delete',
  deleteConfirmNo: 'Cancel',
  exposeToolToLlm: 'Expose the task tool to the LLM',
  exposeToolToLlmHint: 'When on, the LLM can list and manage tasks via the task_runner_config tool',
  saveFailed: 'Save failed: {message}',
  emptyList: 'No tasks yet',
  emptyListHint: 'Click + above to create a task',
}

/** Merge this plugin's namespace into the slot locale table (official pattern). */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's own UI copy. */
    'task-runner': TaskRunnerLocaleKey
  }
}
