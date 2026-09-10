import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  changeMangaReading,
  readingControlErrorKey,
  ReadingControlError,
  type ReadingCommand,
} from "./readingClient.ts";
const enabled = {
  enabled: true,
  prefetch: false,
  scope: "https://reader.test/g/1/*/",
  expires: Date.now() + 60_000,
};
const disabled = { enabled: false, prefetch: false };
const failure = (code: string) => (error: unknown) =>
  error instanceof ReadingControlError && error.code === code;

describe("continuous-reading switch feedback", () => {
  it("sends explicit enable intent and returns confirmed background state", async () => {
    const commands: ReadingCommand[] = [];
    const result = await changeMangaReading(
      async (message) => {
        commands.push(message);
        return { success: true, state: enabled };
      },
      true,
      false,
    );
    assert.deepEqual(result, enabled);
    assert.deepEqual(commands, [
      {
        type: "MANGA_READING_SET",
        payload: { enabled: true, prefetch: false },
      },
    ]);
  });
  it("turning off also disables next-page prefetch", async () => {
    await changeMangaReading(
      async (message) => {
        assert.deepEqual(message.payload, disabled);
        return { success: true, state: disabled };
      },
      false,
      true,
    );
  });
  it("reports page-change rejection instead of a generic paused-task status", async () => {
    await assert.rejects(
      changeMangaReading(
        async () => ({ success: false, errorCode: "READING_PAGE_CHANGED" }),
        true,
        false,
      ),
      failure("READING_PAGE_CHANGED"),
    );
  });
  it("maps a disconnected receiver without leaking its raw error details", async () => {
    await assert.rejects(
      changeMangaReading(
        async () => {
          throw Error("private receiver details");
        },
        true,
        false,
      ),
      (error) => {
        assert.ok(error instanceof ReadingControlError);
        assert.equal(error.code, "READING_CONNECTION");
        assert.equal(error.message.includes("private"), false);
        return true;
      },
    );
  });
  it("ends a hung enable and revokes it rather than silently leaving future-page consent enabled", async () => {
    const commands: ReadingCommand[] = [];
    const send = async (message: ReadingCommand) => {
      commands.push(message);
      if (commands.length === 1) return new Promise(() => {});
      return { success: true, state: disabled };
    };
    await assert.rejects(
      changeMangaReading(send, true, false, 10),
      failure("READING_TIMEOUT"),
    );
    assert.deepEqual(
      commands.map((c) => c.payload),
      [{ enabled: true, prefetch: false }, disabled],
    );
  });
  it("does not turn a hung disable into another enable request", async () => {
    let calls = 0;
    await assert.rejects(
      changeMangaReading(
        async () => {
          calls++;
          return new Promise(() => {});
        },
        false,
        false,
        10,
      ),
      failure("READING_TIMEOUT"),
    );
    assert.equal(calls, 1);
  });
  it("rejects incomplete, mismatched or malformed confirmations", async () => {
    for (const response of [
      undefined,
      { success: true },
      { success: true, state: disabled },
      { success: true, state: { ...enabled, prefetch: true } },
      { success: true, state: { ...enabled, scope: "" } },
      { success: true, state: { ...enabled, expires: "invalid" } },
    ]) {
      await assert.rejects(
        changeMangaReading(async () => response, true, false),
        failure("READING_CONNECTION"),
      );
    }
  });
  it("chooses brief and distinct error labels for the UI", () => {
    assert.equal(
      readingControlErrorKey(new ReadingControlError("READING_TIMEOUT")),
      "manga.readingTimedOut",
    );
    assert.equal(
      readingControlErrorKey(new ReadingControlError("READING_PAGE_CHANGED")),
      "manga.readingPageChanged",
    );
    assert.equal(
      readingControlErrorKey(new Error("sensitive")),
      "manga.readingConnectionFailed",
    );
  });
});
