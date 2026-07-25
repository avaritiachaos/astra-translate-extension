// ============================================================
// Astra Translate – Short UI Lexicon (instant, zero-API)
// ============================================================
// Common chrome / form labels resolved locally so buttons and nav
// words appear immediately without waiting for a model round-trip.
// Only exact (normalized) short phrases match; prose never hits this.

/** Normalize for lookup: trim, collapse space, case-fold. */
export function normalizeUiKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

type TargetMap = Record<string, string>;

interface LexiconEntry {
  /** Source phrases in any common UI language (already lowercased keys). */
  sources: string[];
  /** Translations keyed by Astra target language name. */
  targets: TargetMap;
}

/**
 * Compact multi-source → multi-target table for the labels users see most.
 * Prefer precision over coverage: wrong instant gloss is worse than waiting.
 */
const ENTRIES: LexiconEntry[] = [
  {
    sources: ["login", "log in", "sign in", "signin", "вход", "войти", "ログイン", "登录", "登入"],
    targets: {
      "Simplified Chinese": "登录",
      "Traditional Chinese": "登入",
      English: "Log in",
      Japanese: "ログイン",
      Korean: "로그인",
      Russian: "Вход",
      French: "Connexion",
      German: "Anmelden",
      Spanish: "Iniciar sesión",
    },
  },
  {
    sources: ["log out", "logout", "sign out", "signout", "выход", "выйти", "ログアウト", "退出", "登出"],
    targets: {
      "Simplified Chinese": "退出",
      "Traditional Chinese": "登出",
      English: "Log out",
      Japanese: "ログアウト",
      Korean: "로그아웃",
      Russian: "Выход",
    },
  },
  {
    sources: ["register", "sign up", "signup", "registration", "регистрация", "зарегистрироваться", "登録", "注册", "註冊"],
    targets: {
      "Simplified Chinese": "注册",
      "Traditional Chinese": "註冊",
      English: "Register",
      Japanese: "登録",
      Korean: "가입",
      Russian: "Регистрация",
    },
  },
  {
    sources: ["search", "поиск", "искать", "検索", "搜索", "搜尋", "찾기"],
    targets: {
      "Simplified Chinese": "搜索",
      "Traditional Chinese": "搜尋",
      English: "Search",
      Japanese: "検索",
      Korean: "검색",
      Russian: "Поиск",
    },
  },
  {
    sources: ["home", "homepage", "main", "главная", "ホーム", "主页", "首页", "首頁"],
    targets: {
      "Simplified Chinese": "首页",
      "Traditional Chinese": "首頁",
      English: "Home",
      Japanese: "ホーム",
      Korean: "홈",
      Russian: "Главная",
    },
  },
  {
    sources: ["submit", "send", "отправить", "送信", "提交", "送出"],
    targets: {
      "Simplified Chinese": "提交",
      "Traditional Chinese": "送出",
      English: "Submit",
      Japanese: "送信",
      Korean: "제출",
      Russian: "Отправить",
    },
  },
  {
    sources: ["save", "сохранить", "保存", "儲存", "저장"],
    targets: {
      "Simplified Chinese": "保存",
      "Traditional Chinese": "儲存",
      English: "Save",
      Japanese: "保存",
      Korean: "저장",
      Russian: "Сохранить",
    },
  },
  {
    sources: ["cancel", "отмена", "отменить", "キャンセル", "取消"],
    targets: {
      "Simplified Chinese": "取消",
      "Traditional Chinese": "取消",
      English: "Cancel",
      Japanese: "キャンセル",
      Korean: "취소",
      Russian: "Отмена",
    },
  },
  {
    sources: ["close", "закрыть", "閉じる", "关闭", "關閉"],
    targets: {
      "Simplified Chinese": "关闭",
      "Traditional Chinese": "關閉",
      English: "Close",
      Japanese: "閉じる",
      Korean: "닫기",
      Russian: "Закрыть",
    },
  },
  {
    sources: ["delete", "remove", "удалить", "削除", "删除", "刪除"],
    targets: {
      "Simplified Chinese": "删除",
      "Traditional Chinese": "刪除",
      English: "Delete",
      Japanese: "削除",
      Korean: "삭제",
      Russian: "Удалить",
    },
  },
  {
    sources: ["edit", "редактировать", "編集", "编辑", "編輯"],
    targets: {
      "Simplified Chinese": "编辑",
      "Traditional Chinese": "編輯",
      English: "Edit",
      Japanese: "編集",
      Korean: "편집",
      Russian: "Редактировать",
    },
  },
  {
    sources: ["download", "скачать", "ダウンロード", "下载", "下載"],
    targets: {
      "Simplified Chinese": "下载",
      "Traditional Chinese": "下載",
      English: "Download",
      Japanese: "ダウンロード",
      Korean: "다운로드",
      Russian: "Скачать",
    },
  },
  {
    sources: ["upload", "загрузить", "アップロード", "上传", "上傳"],
    targets: {
      "Simplified Chinese": "上传",
      "Traditional Chinese": "上傳",
      English: "Upload",
      Japanese: "アップロード",
      Korean: "업로드",
      Russian: "Загрузить",
    },
  },
  {
    sources: ["settings", "options", "preferences", "настройки", "設定", "设置", "設定"],
    targets: {
      "Simplified Chinese": "设置",
      "Traditional Chinese": "設定",
      English: "Settings",
      Japanese: "設定",
      Korean: "설정",
      Russian: "Настройки",
    },
  },
  {
    sources: ["help", "помощь", "ヘルプ", "帮助", "說明"],
    targets: {
      "Simplified Chinese": "帮助",
      "Traditional Chinese": "說明",
      English: "Help",
      Japanese: "ヘルプ",
      Korean: "도움말",
      Russian: "Помощь",
    },
  },
  {
    sources: ["about", "о сайте", "о нас", "について", "关于", "關於"],
    targets: {
      "Simplified Chinese": "关于",
      "Traditional Chinese": "關於",
      English: "About",
      Japanese: "について",
      Korean: "정보",
      Russian: "О сайте",
    },
  },
  {
    sources: ["rules", "правила", "ルール", "规则", "規則"],
    targets: {
      "Simplified Chinese": "规则",
      "Traditional Chinese": "規則",
      English: "Rules",
      Japanese: "ルール",
      Korean: "규칙",
      Russian: "Правила",
    },
  },
  {
    sources: ["faq", "часто задаваемые вопросы", "常见问题", "常見問題"],
    targets: {
      "Simplified Chinese": "常见问题",
      "Traditional Chinese": "常見問題",
      English: "FAQ",
      Japanese: "よくある質問",
      Korean: "FAQ",
      Russian: "Частые вопросы",
    },
  },
  {
    // Include "имя" / "имя:" — on login forms this is almost always "username".
    sources: [
      "username",
      "user name",
      "login name",
      "имя",
      "имя:",
      "имя пользователя",
      "ユーザー名",
      "用户名",
      "使用者名稱",
    ],
    targets: {
      "Simplified Chinese": "用户名",
      "Traditional Chinese": "使用者名稱",
      English: "Username",
      Japanese: "ユーザー名",
      Korean: "사용자 이름",
      Russian: "Имя",
    },
  },
  {
    sources: ["password", "пароль", "пароль:", "パスワード", "密码", "密碼"],
    targets: {
      "Simplified Chinese": "密码",
      "Traditional Chinese": "密碼",
      English: "Password",
      Japanese: "パスワード",
      Korean: "비밀번호",
      Russian: "Пароль",
    },
  },
  {
    sources: ["email", "e-mail", "почта", "электронная почта", "メール", "邮箱", "電子郵件"],
    targets: {
      "Simplified Chinese": "邮箱",
      "Traditional Chinese": "電子郵件",
      English: "Email",
      Japanese: "メール",
      Korean: "이메일",
      Russian: "Почта",
    },
  },
  {
    sources: ["name", "name:", "名前", "名称", "姓名"],
    targets: {
      "Simplified Chinese": "名称",
      "Traditional Chinese": "名稱",
      English: "Name",
      Japanese: "名前",
      Korean: "이름",
      Russian: "Имя",
    },
  },
  {
    sources: ["forgot password", "forgot username or password?", "забыли имя или пароль?", "忘记用户名或密码?", "忘记密码"],
    targets: {
      "Simplified Chinese": "忘记用户名或密码？",
      "Traditional Chinese": "忘記使用者名稱或密碼？",
      English: "Forgot username or password?",
      Japanese: "ユーザー名またはパスワードをお忘れですか？",
      Russian: "Забыли имя или пароль?",
    },
  },
  {
    sources: ["next", "далее", "следующий", "次へ", "下一步", "下一頁"],
    targets: {
      "Simplified Chinese": "下一步",
      "Traditional Chinese": "下一步",
      English: "Next",
      Japanese: "次へ",
      Korean: "다음",
      Russian: "Далее",
    },
  },
  {
    sources: ["previous", "back", "назад", "前へ", "上一步", "返回", "上一頁"],
    targets: {
      "Simplified Chinese": "返回",
      "Traditional Chinese": "返回",
      English: "Back",
      Japanese: "戻る",
      Korean: "이전",
      Russian: "Назад",
    },
  },
  {
    sources: ["ok", "okay", "хорошо", "ок", "确定", "確定"],
    targets: {
      "Simplified Chinese": "确定",
      "Traditional Chinese": "確定",
      English: "OK",
      Japanese: "OK",
      Korean: "확인",
      Russian: "ОК",
    },
  },
  {
    sources: ["yes", "да", "はい", "是", "是的"],
    targets: {
      "Simplified Chinese": "是",
      "Traditional Chinese": "是",
      English: "Yes",
      Japanese: "はい",
      Korean: "예",
      Russian: "Да",
    },
  },
  {
    sources: ["no", "нет", "いいえ", "否", "不"],
    targets: {
      "Simplified Chinese": "否",
      "Traditional Chinese": "否",
      English: "No",
      Japanese: "いいえ",
      Korean: "아니요",
      Russian: "Нет",
    },
  },
  {
    sources: ["tracker", "трекер", "追踪器", "追蹤器"],
    targets: {
      "Simplified Chinese": "追踪器",
      "Traditional Chinese": "追蹤器",
      English: "Tracker",
      Japanese: "トラッカー",
      Russian: "Трекер",
    },
  },
  {
    sources: ["groups", "группы", "グループ", "群组", "群組"],
    targets: {
      "Simplified Chinese": "群组",
      "Traditional Chinese": "群組",
      English: "Groups",
      Japanese: "グループ",
      Russian: "Группы",
    },
  },
  {
    sources: ["donate", "donations", "донаты", "пожертвования", "捐赠", "捐贈", "捐款"],
    targets: {
      "Simplified Chinese": "捐赠",
      "Traditional Chinese": "捐贈",
      English: "Donate",
      Japanese: "寄付",
      Russian: "Донаты",
    },
  },
  {
    sources: ["vpn"],
    targets: {
      "Simplified Chinese": "VPN",
      "Traditional Chinese": "VPN",
      English: "VPN",
      Japanese: "VPN",
      Russian: "VPN",
    },
  },
  {
    sources: ["moderators", "модераторы", "版主", "モデレーター"],
    targets: {
      "Simplified Chinese": "版主",
      "Traditional Chinese": "版主",
      English: "Moderators",
      Japanese: "モデレーター",
      Russian: "Модераторы",
    },
  },
  {
    sources: ["administration", "администрация", "管理团队", "管理", "運営"],
    targets: {
      "Simplified Chinese": "管理团队",
      "Traditional Chinese": "管理團隊",
      English: "Administration",
      Japanese: "運営",
      Russian: "Администрация",
    },
  },
  {
    sources: ["tech support", "support", "техническая поддержка", "技术支持", "技術支援"],
    targets: {
      "Simplified Chinese": "技术支持",
      "Traditional Chinese": "技術支援",
      English: "Support",
      Japanese: "サポート",
      Russian: "Поддержка",
    },
  },
  {
    sources: ["telegram", "telegram channel", "telegram-канал", "telegram频道", "telegram 频道"],
    targets: {
      "Simplified Chinese": "Telegram频道",
      "Traditional Chinese": "Telegram頻道",
      English: "Telegram channel",
      Japanese: "Telegramチャンネル",
      Russian: "Telegram-канал",
    },
  },
];

/** sourceNorm → targetLang → translation */
const LOOKUP = new Map<string, TargetMap>();

for (const entry of ENTRIES) {
  for (const src of entry.sources) {
    const key = normalizeUiKey(src);
    if (!key) continue;
    const existing = LOOKUP.get(key) || {};
    LOOKUP.set(key, { ...existing, ...entry.targets });
  }
}

/** Also accept labels that end with a colon / fullwidth colon (form fields). */
function lookupKeys(text: string): string[] {
  const norm = normalizeUiKey(text);
  if (!norm) return [];
  const keys = [norm];
  // "Имя:" / "Name：" → also try without trailing colon
  const noColon = norm.replace(/[:：]\s*$/, "").trim();
  if (noColon && noColon !== norm) keys.push(noColon);
  return keys;
}

/**
 * Instant translation for a short UI phrase, or null if unknown / already
 * in the target language with no mapping needed.
 * Only applied to short strings (≤ 48 chars) to avoid accidental prose hits.
 */
export function lookupUiLexicon(text: string, targetLang: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 48) return null;

  for (const key of lookupKeys(trimmed)) {
    const map = LOOKUP.get(key);
    if (!map) continue;
    const hit = map[targetLang];
    if (hit) {
      // Preserve a trailing colon if the source had one and the hit doesn't.
      if (/[:：]\s*$/.test(trimmed) && !/[:：]\s*$/.test(hit)) {
        return hit + (trimmed.includes("：") ? "：" : ":");
      }
      return hit;
    }
  }
  return null;
}

/** Test helper: number of source keys loaded. */
export function uiLexiconSize(): number {
  return LOOKUP.size;
}
