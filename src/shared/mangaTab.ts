export type MangaPageFailure = "unsupported" | "unreachable" | "startFailed";
export class MangaPageError extends Error {
  code: MangaPageFailure;
  constructor(code: MangaPageFailure) {
    super(code);
    this.name = "MangaPageError";
    this.code = code;
  }
}

export interface MangaTabApi {
  tabs: {
    sendMessage(
      tabId: number,
      message: object,
      options: { frameId: number },
    ): Promise<unknown>;
  };
  scripting: {
    executeScript(options: {
      target: { tabId: number; frameIds: number[] };
      files: string[];
    }): Promise<unknown>;
  };
}

export function isMangaPageUrl(value?: string): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      /^(https?:)$/.test(url.protocol) &&
      url.hostname !== "chromewebstore.google.com" &&
      !(
        url.hostname === "chrome.google.com" &&
        url.pathname.startsWith("/webstore")
      )
    );
  } catch {
    return false;
  }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new MangaPageError("unreachable")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type Reply = {
  success?: boolean;
  pickerVersion?: number;
  pickerReady?: boolean;
  currentStarted?: boolean;
  batchStarted?: boolean;
};

// Only inject the manga controller. Reinjecting content.js would duplicate
// selection, floating-ball and chat listeners on an already-open page.
export async function openMangaPicker(
  tab: { id?: number; url?: string },
  api: MangaTabApi = chrome,
  timeoutMs = 2000,
  action: "select" | "current" | "batch" = "select",
): Promise<void> {
  if (!Number.isInteger(tab.id) || tab.id! < 0 || !isMangaPageUrl(tab.url))
    throw new MangaPageError("unsupported");
  const tabId = tab.id!;
  const send = (type: string) =>
    withTimeout(
      api.tabs.sendMessage(tabId, { type }, { frameId: 0 }) as Promise<
        Reply | undefined
      >,
      timeoutMs,
    );
  const ready = async () => {
    try {
      const reply = await send("MANGA_PING");
      return reply?.success === true && reply.pickerVersion === 2;
    } catch {
      return false;
    }
  };
  if (!(await ready())) {
    try {
      await api.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ["manga-content.js"],
      });
    } catch {
      throw new MangaPageError("unreachable");
    }
    if (!(await ready())) throw new MangaPageError("unreachable");
  }
  let reply: Reply | undefined;
  try {
    reply = await send(
      action === "current"
        ? "MANGA_TRANSLATE_CURRENT"
        : action === "batch"
          ? "MANGA_START_BATCH"
          : "MANGA_PICK_IMAGE",
    );
  } catch {
    throw new MangaPageError("unreachable");
  }
  if (
    !reply?.success ||
    !(
      reply.pickerReady ||
      (action === "current" && reply.currentStarted) ||
      (action === "batch" && (reply.batchStarted || reply.currentStarted))
    )
  )
    throw new MangaPageError("startFailed");
}

export async function translateCurrentMangaPage(
  tab: { id?: number; url?: string },
  api: MangaTabApi = chrome,
): Promise<void> {
  return openMangaPicker(tab, api, 2000, "current");
}

export async function prefetchMangaChapter(
  tab: { id?: number; url?: string },
  api: MangaTabApi = chrome,
): Promise<void> {
  return openMangaPicker(tab, api, 2000, "batch");
}
