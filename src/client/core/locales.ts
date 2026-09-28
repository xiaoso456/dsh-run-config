/**
 * Locale bundles for the dsh-run-config UI. zh is the source of truth for the
 * key set; en is checked complete against it — both dictionaries are typed
 * `Record<TaskRunnerLocaleKey, string>`, so a missing or extra key in either is
 * a compile error (the official registration enforces bilingual balance).
 * @module @xiaoso/dsh-run-config/client/locales
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
  | 'loadingTasks'
  | 'tasksLoadFailed'
  | 'tasksLoadFailedDetail'
  | 'started'
  | 'runFailed'
  | 'runUnavailable'
  | 'filledIn'
  | 'draftReplaced'
  | 'filledInReplaced'
  | 'config'
  | 'heroAddWorkspace'
  | 'heroPathPlaceholder'
  | 'heroCreate'
  | 'heroSearchWorkspace'
  | 'heroNoWorkspaces'
  | 'heroNoWorkspace'
  | 'configTitle'
  | 'fieldName'
  | 'fieldDescription'
  | 'fieldDescriptionHint'
  | 'fieldType'
  | 'fieldScope'
  | 'fieldWorkspace'
  | 'fieldPrompt'
  | 'fieldPromptHint'
  | 'fieldAutoSend'
  | 'fieldAutoSendHint'
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
  | 'noMatchTasks'
  | 'editingOutsideFilter'

/** Simplified Chinese copy. */
export const zh: Record<TaskRunnerLocaleKey, string> = {
  run: '运行',
  runTaskHint: '运行任务配置「{name}」（命令任务在当前会话的工作目录执行，LLM 任务向当前会话发送）',
  selectTask: '选择任务运行配置',
  groupGlobal: '全局',
  groupWorkspace: '当前工作区',
  searchPlaceholder: '搜索任务配置…',
  editConfig: '编辑任务配置…',
  noVisibleTasks: '没有可见任务运行配置',
  loadingTasks: '正在加载任务运行配置…',
  tasksLoadFailed: '任务配置加载失败',
  tasksLoadFailedDetail: '任务配置加载失败：{message}',
  started: '已启动 {id}',
  runFailed: '运行失败：{message}',
  runUnavailable: '该任务配置已不存在，无法运行',
  filledIn: '已填入输入框，可修改后发送',
  draftReplaced: '已用配置的 Prompt 替换输入框中的原有内容',
  filledInReplaced: '已填入输入框（原有草稿已被替换），可修改后发送',
  config: '任务运行配置',
  heroAddWorkspace: '添加工作区…',
  heroPathPlaceholder: '输入工作区路径',
  heroCreate: '创建',
  heroSearchWorkspace: '搜索工作区…',
  heroNoWorkspaces: '没有匹配的工作区',
  heroNoWorkspace: '请先选择一个工作区',
  configTitle: '任务运行配置',
  fieldName: '名称',
  fieldDescription: '描述',
  fieldDescriptionHint: '说明这个任务是做什么的（可选）',
  fieldType: '类型',
  fieldScope: '作用域',
  fieldWorkspace: '工作区',
  fieldPrompt: 'Prompt',
  fieldPromptHint: '运行后自动填入输入框并发送',
  fieldAutoSend: '运行后直接发送',
  fieldAutoSendHint: '关闭后，点击运行仅填入输入框，可修改后发送',
  fieldCommand: '命令',
  fieldCommandHint: '在当前会话的工作目录执行的 Shell 命令（会话没有工作目录时用任务所属工作区）',
  fieldNotifyLlm: '完成后通知 LLM',
  fieldNotifyLlmHint: '命令结束后把结果告知 LLM',
  typeLlm: 'LLM 任务配置',
  typeCommand: '命令任务配置',
  scopeGlobal: '全局',
  scopeWorkspace: '工作区',
  workspacePlaceholder: '选择工作区…',
  newTaskName: '新建任务配置',
  btnCancel: '取消',
  btnSave: '保存',
  savedText: '已保存',
  btnAdd: '新增',
  btnDuplicate: '复制为同名副本（可在右侧改名）',
  btnDelete: '删除',
  deleteConfirmTitle: '删除任务配置',
  deleteConfirmBody: '确定删除「{name}」？',
  deleteConfirmYes: '删除',
  deleteConfirmNo: '取消',
  exposeToolToLlm: '暴露任务配置管理工具给 LLM',
  exposeToolToLlmHint: '开启后，LLM 可通过 task_run_config 工具查看和修改任务运行配置',
  saveFailed: '保存失败：{message}',
  emptyList: '暂无任务配置',
  emptyListHint: '点击上方 + 新建任务配置',
  noMatchTasks: '没有匹配的任务运行配置',
  editingOutsideFilter: '正在编辑的配置不在当前筛选结果中',
}

/** English copy. */
export const en: Record<TaskRunnerLocaleKey, string> = {
  run: 'Run',
  runTaskHint:
    'Run configuration "{name}" (a command runs in the current session working directory; an LLM one is sent to the current session)',
  selectTask: 'Select a run configuration',
  groupGlobal: 'Global',
  groupWorkspace: 'Current workspace',
  searchPlaceholder: 'Search configurations…',
  editConfig: 'Edit configurations…',
  noVisibleTasks: 'No visible run configurations',
  loadingTasks: 'Loading run configurations…',
  tasksLoadFailed: 'Failed to load run configurations',
  tasksLoadFailedDetail: 'Failed to load run configurations: {message}',
  started: 'Started {id}',
  runFailed: 'Run failed: {message}',
  runUnavailable: 'That run configuration no longer exists',
  filledIn: 'Filled into the composer — edit and send when ready',
  draftReplaced: 'Replaced the composer draft with this configuration prompt',
  filledInReplaced: 'Filled into the composer (your draft was replaced) — edit and send when ready',
  config: 'Run configurations',
  heroAddWorkspace: 'Add workspace…',
  heroPathPlaceholder: 'Enter a workspace path',
  heroCreate: 'Create',
  heroSearchWorkspace: 'Search workspaces…',
  heroNoWorkspaces: 'No matching workspaces',
  heroNoWorkspace: 'Select a workspace first',
  configTitle: 'Run configurations',
  fieldName: 'Name',
  fieldDescription: 'Description',
  fieldDescriptionHint: 'What this task does (optional)',
  fieldType: 'Type',
  fieldScope: 'Scope',
  fieldWorkspace: 'Workspace',
  fieldPrompt: 'Prompt',
  fieldPromptHint: 'Fills the composer and submits when run',
  fieldAutoSend: 'Send immediately on run',
  fieldAutoSendHint: 'When off, running only fills the composer — edit and send when ready',
  fieldCommand: 'Command',
  fieldCommandHint:
    'Shell command run in the current session working directory (falls back to the configuration workspace)',
  fieldNotifyLlm: 'Notify the LLM when finished',
  fieldNotifyLlmHint: 'Reports the result to the LLM after the command ends',
  typeLlm: 'LLM configuration',
  typeCommand: 'Command configuration',
  scopeGlobal: 'Global',
  scopeWorkspace: 'Workspace',
  workspacePlaceholder: 'Select a workspace…',
  newTaskName: 'New configuration',
  btnCancel: 'Cancel',
  btnSave: 'Save',
  savedText: 'Saved',
  btnAdd: 'New',
  btnDuplicate: 'Duplicate as a same-named copy (rename it on the right)',
  btnDelete: 'Delete',
  deleteConfirmTitle: 'Delete configuration',
  deleteConfirmBody: 'Delete "{name}"?',
  deleteConfirmYes: 'Delete',
  deleteConfirmNo: 'Cancel',
  exposeToolToLlm: 'Expose the configuration tool to the LLM',
  exposeToolToLlmHint:
    'When on, the LLM can list and manage run configurations via the task_run_config tool',
  saveFailed: 'Save failed: {message}',
  emptyList: 'No configurations yet',
  emptyListHint: 'Click + above to create a configuration',
  noMatchTasks: 'No matching run configurations',
  editingOutsideFilter: 'Editing a configuration the current filter hides',
}

/** Merge this plugin's namespace into the slot locale table (official pattern). */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This plugin's own UI copy. */
    'task-runner': TaskRunnerLocaleKey
  }
}
