import type { MangaReadingState } from "./readingPolicy.ts";
export type ReadingControlFailure =
  "READING_PAGE_CHANGED" | "READING_TIMEOUT" | "READING_CONNECTION";
export class ReadingControlError extends Error {
  code: ReadingControlFailure;
  constructor(code: ReadingControlFailure) {
    super(code);
    this.code = code;
    this.name = "ReadingControlError";
  }
}
export type ReadingCommand = {
  type: "MANGA_READING_SET";
  payload: { enabled: boolean; prefetch: boolean };
};
type SendReading = (message: ReadingCommand) => Promise<unknown>;

/** An unavailable receiver must not leave the switch spinning indefinitely. */
export async function changeMangaReading(
  send: SendReading,
  enabled: boolean,
  prefetch: boolean,
  timeoutMs = 6000,
): Promise<MangaReadingState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = (await Promise.race([
      send({
        type: "MANGA_READING_SET",
        payload: { enabled, prefetch: enabled && prefetch },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ReadingControlError("READING_TIMEOUT")),
          timeoutMs,
        );
      }),
    ])) as {
      success?: boolean;
      errorCode?: string;
      state?: MangaReadingState;
    } | null;
    if (
      result?.success !== true ||
      !result.state ||
      result.state.enabled !== enabled ||
      result.state.prefetch !== (enabled && prefetch) ||
      (enabled &&
        (typeof result.state.scope !== "string" ||
          !result.state.scope ||
          !Number.isFinite(result.state.expires)))
    ) {
      throw new ReadingControlError(
        result?.errorCode === "READING_PAGE_CHANGED"
          ? "READING_PAGE_CHANGED"
          : "READING_CONNECTION",
      );
    }
    return result.state;
  } catch (error) {
    if (
      error instanceof ReadingControlError &&
      error.code === "READING_TIMEOUT" &&
      enabled
    ) {
      // Queue a revocation behind a tardy enable, so navigating cannot revive
      // consent that the UI reported as failed. Never resend an enable automatically.
      void Promise.resolve()
        .then(() =>
          send({
            type: "MANGA_READING_SET",
            payload: { enabled: false, prefetch: false },
          }),
        )
        .catch(() => {});
    }
    throw error instanceof ReadingControlError
      ? error
      : new ReadingControlError("READING_CONNECTION");
  } finally {
    clearTimeout(timer);
  }
}
export function readingControlErrorKey(error: unknown): string {
  if (
    error instanceof ReadingControlError &&
    error.code === "READING_PAGE_CHANGED"
  )
    return "manga.readingPageChanged";
  if (error instanceof ReadingControlError && error.code === "READING_TIMEOUT")
    return "manga.readingTimedOut";
  return "manga.readingConnectionFailed";
}
