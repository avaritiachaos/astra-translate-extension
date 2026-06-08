// ============================================================
// Astra Translate – i18n (轻量国际化)
// ============================================================

export type UiLanguage = "zh-CN" | "en-US";

type MessageDict = Record<string, string>;

const zhCN: MessageDict = {
  // ---- 通用 ----
  "app.name": "Astra Translate",
  "app.desc": "轻量、优雅、模型服务商中立的浏览器翻译插件。",
  "app.version": "Astra Translate v1.0.0 · 模型服务商中立的浏览器翻译插件",

  // ---- Options 页面 ----
  "opt.provider": "服务商设置",
  "opt.providerPreset": "服务商预设",
  "opt.apiFormat": "API 格式",
  "opt.baseUrl": "Base URL",
  "opt.endpoint": "Endpoint / 接口路径",
  "opt.model": "模型",
  "opt.apiKey": "API Key",
  "opt.disableThinking": "禁用思考模式以提升翻译速度",
  "opt.testConnection": "测试连接",
  "opt.testing": "测试中…",
  "opt.testSuccess": "连接成功！模型：{model}",
  "opt.testFail": "连接失败",
  "opt.testSaveReminder": "记得点击保存设置。",
  "opt.testAutoSaved": "设置已自动保存。",
  "opt.uiLang": "界面语言",

  "opt.translation": "翻译设置",
  "opt.defaultTargetLang": "默认目标语言",
  "opt.temperature": "温度",
  "opt.temperatureHint": "越低越稳定，默认 0.2",
  "opt.timeout": "请求超时",
  "opt.batchSize": "页面翻译批量字符数",
  "opt.concurrency": "并发数",
  "opt.realtime": "实时页面翻译",

  "opt.prompt": "Prompt 设置",
  "opt.selectionPrompt": "划词 / 手动翻译 Prompt",
  "opt.pagePrompt": "页面翻译 Prompt",
  "opt.promptHint1": "使用 {targetLang} 作为目标语言占位符。",
  "opt.promptHint2": "使用 {targetLang} 作为占位符，模型必须返回合法 JSON。",
  "opt.resetPrompts": "恢复默认 Prompt",

  "opt.save": "保存设置",
  "opt.reset": "恢复默认设置",
  "opt.saved": "保存成功",
  "opt.saveFailed": "保存失败",
  "opt.geminiSoon": "Gemini-compatible（即将支持）",
  "opt.anthropicSoon": "Anthropic-compatible（即将支持）",

  // ---- Popup 页面 ----
  "popup.sourceLang": "源语言",
  "popup.targetLang": "目标语言",
  "popup.auto": "自动检测",
  "popup.translate": "翻译",
  "popup.translating": "翻译中…",
  "popup.clear": "清空",
  "popup.copy": "复制",
  "popup.copied": "已复制",
  "popup.placeholder": "输入或粘贴要翻译的内容",
  "popup.resultPlaceholder": "翻译结果会显示在这里",
  "popup.translatePage": "翻译当前页面",
  "popup.restorePage": "还原当前页面",
  "popup.pageTranslating": "正在翻译页面…",
  "popup.pageRestored": "已还原原文",
  "popup.openSettings": "打开设置",
  "popup.pageTranslation": "页面翻译",
  "popup.noApiKey": "请先在设置页配置 API Key",
  "popup.connectFail": "无法连接到翻译服务。",
  "popup.cannotAccess": "无法访问当前页面。",
  "popup.kbHint": "Ctrl+Enter 翻译 · Esc 清空",

  // ---- Content 划词气泡 ----
  "bubble.title": "Astra Translate",
  "bubble.translateSelection": "翻译选中文本",
  "bubble.source": "原文",
  "bubble.copyTranslation": "复制译文",
  "bubble.pin": "固定",
  "bubble.unpin": "取消固定",
  "bubble.close": "关闭",
  "bubble.translating": "正在翻译…",
  "bubble.translationFailed": "翻译失败",
  "bubble.connectFail": "无法连接到翻译服务。",

  // ---- 页面翻译浮层 ----
  "page.collecting": "正在收集文本…",
  "page.translating": "正在翻译页面 {done} / {total}",
  "page.translatingWithFail": "正在翻译页面 {done} / {total}（{failed} 失败）",
  "page.completed": "页面翻译完成 ✓",
  "page.completedWithFail": "翻译完成（{failed} 项失败）",
  "page.failed": "页面翻译失败",
  "page.restored": "已还原原文",

  // ---- 错误提示 ----
  "error.apiKeyMissing": "缺少 API Key",
  "error.apiKeyNotConfigured": "请先在设置页填写 API Key。",
  "error.unauthorized": "API Key 错误或无权限，请检查账户余额。",
  "error.rateLimit": "请求频率受限，请稍后再试。",
  "error.serverUnavailable": "服务商暂时不可用，请稍后再试。",
  "error.timeout": "请求超时，请重试或增加超时时间。",
  "error.network": "网络连接失败，请检查网络。",
  "error.invalidResponse": "模型返回格式异常。",
  "error.translationFailed": "翻译失败，请重试。",
  "error.batchFailed": "批量翻译失败，请重试。",
  "error.invalidBatchResponse": "模型返回了无效的 JSON 格式，请重试。",
  "error.httpError": "请求失败，状态码：{status}",
  "error.unknown": "未知错误",
  "error.geminiNotImplemented": "Gemini-compatible API 尚未实现，请使用 OpenAI-compatible 服务商。",
  "error.anthropicNotImplemented": "Anthropic-compatible API 尚未实现，请使用 OpenAI-compatible 服务商。",
  "error.unknownApiFormat": "未知的 API 格式：{format}",
};

const enUS: MessageDict = {
  // ---- General ----
  "app.name": "Astra Translate",
  "app.desc": "A lightweight, elegant, provider-neutral browser translator.",
  "app.version": "Astra Translate v1.0.0 · Provider-neutral browser translator",

  // ---- Options ----
  "opt.provider": "Provider Settings",
  "opt.providerPreset": "Provider Preset",
  "opt.apiFormat": "API Format",
  "opt.baseUrl": "Base URL",
  "opt.endpoint": "Endpoint",
  "opt.model": "Model",
  "opt.apiKey": "API Key",
  "opt.disableThinking": "Disable thinking (for faster translation)",
  "opt.testConnection": "Test Connection",
  "opt.testing": "Testing…",
  "opt.testSuccess": "Connection successful! Model: {model}",
  "opt.testFail": "Connection failed",
  "opt.testSaveReminder": "Remember to save your settings.",
  "opt.testAutoSaved": "Settings auto-saved.",
  "opt.uiLang": "UI Language",

  "opt.translation": "Translation Settings",
  "opt.defaultTargetLang": "Default Target Language",
  "opt.temperature": "Temperature",
  "opt.temperatureHint": "Lower = more consistent, default 0.2",
  "opt.timeout": "Timeout (ms)",
  "opt.batchSize": "Page Batch Size (chars)",
  "opt.concurrency": "Concurrency",
  "opt.realtime": "Real-time Page Translation",

  "opt.prompt": "Prompt Settings",
  "opt.selectionPrompt": "Selection / Manual Translation Prompt",
  "opt.pagePrompt": "Page Translation Prompt",
  "opt.promptHint1": "Use {targetLang} as placeholder for the target language.",
  "opt.promptHint2": "Use {targetLang} as placeholder. The model must return valid JSON.",
  "opt.resetPrompts": "Restore Default Prompts",

  "opt.save": "Save Settings",
  "opt.reset": "Reset All to Default",
  "opt.saved": "Settings saved!",
  "opt.saveFailed": "Failed to save settings.",
  "opt.geminiSoon": "Gemini-compatible (coming soon)",
  "opt.anthropicSoon": "Anthropic-compatible (coming soon)",

  // ---- Popup ----
  "popup.sourceLang": "Source Language",
  "popup.targetLang": "Target Language",
  "popup.auto": "Auto",
  "popup.translate": "Translate",
  "popup.translating": "Translating…",
  "popup.clear": "Clear",
  "popup.copy": "Copy",
  "popup.copied": "Copied!",
  "popup.placeholder": "Enter text to translate…",
  "popup.resultPlaceholder": "Translation will appear here…",
  "popup.translatePage": "Translate Current Page",
  "popup.restorePage": "Restore Current Page",
  "popup.pageTranslating": "Translating page…",
  "popup.pageRestored": "Page restored.",
  "popup.openSettings": "Open Settings",
  "popup.pageTranslation": "Page Translation",
  "popup.noApiKey": "Please configure API Key in settings first.",
  "popup.connectFail": "Failed to connect to translation service.",
  "popup.cannotAccess": "Cannot access the current page.",
  "popup.kbHint": "Ctrl+Enter to translate · Esc to clear",

  // ---- Content Bubble ----
  "bubble.title": "Astra Translate",
  "bubble.translateSelection": "Translate selection",
  "bubble.source": "Source text",
  "bubble.copyTranslation": "Copy translation",
  "bubble.pin": "Pin",
  "bubble.unpin": "Unpin",
  "bubble.close": "Close",
  "bubble.translating": "Translating…",
  "bubble.translationFailed": "Translation failed",
  "bubble.connectFail": "Failed to connect to translation service.",

  // ---- Page Translation ----
  "page.collecting": "Collecting text…",
  "page.translating": "Translating page {done} / {total}",
  "page.translatingWithFail": "Translating page {done} / {total} ({failed} failed)",
  "page.completed": "Page translation complete ✓",
  "page.completedWithFail": "Done ({failed} failed)",
  "page.failed": "Page translation failed",
  "page.restored": "Restored original page",

  // ---- Errors ----
  "error.apiKeyMissing": "API Key is missing",
  "error.apiKeyNotConfigured": "Please configure your API Key in the extension settings.",
  "error.unauthorized": "Authentication failed. Please check your API Key and account balance.",
  "error.rateLimit": "Rate limit exceeded. Please wait a moment and try again.",
  "error.serverUnavailable": "The translation service is temporarily unavailable. Please try again later.",
  "error.timeout": "Request timed out. Please try again or increase the timeout setting.",
  "error.network": "Network connection failed. Please check your internet connection.",
  "error.invalidResponse": "The model returned an unexpected response format.",
  "error.translationFailed": "Translation failed. Please try again.",
  "error.batchFailed": "Batch translation failed. Please try again.",
  "error.invalidBatchResponse": "The model returned an invalid JSON format. Please try again.",
  "error.httpError": "Request failed with status {status}.",
  "error.unknown": "Unknown error",
  "error.geminiNotImplemented": "Gemini-compatible API is not yet implemented. Please use an OpenAI-compatible provider.",
  "error.anthropicNotImplemented": "Anthropic-compatible API is not yet implemented. Please use an OpenAI-compatible provider.",
  "error.unknownApiFormat": "Unknown API format: {format}",
};

const messages: Record<UiLanguage, MessageDict> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

/**
 * 翻译函数
 * @param lang 语言代码
 * @param key 消息 key
 * @param vars 可选变量替换，如 { done: 12, total: 85 }
 */
export function t(lang: UiLanguage, key: string, vars?: Record<string, string | number>): string {
  const dict = messages[lang] || messages["zh-CN"];
  let text = dict[key] || messages["en-US"][key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

/**
 * 获取语言对应的字典（供需要批量获取的场景）
 */
export function getDict(lang: UiLanguage): MessageDict {
  return messages[lang] || messages["zh-CN"];
}
