import type {
  MangaExecution,
  MangaJob,
  MangaResult,
} from "../../shared/manga/types";
import {
  MANGA_ACTIVE_PHASES,
  MANGA_PROMPT_VERSION,
} from "../../shared/manga/types";
import { planTiles } from "../../shared/manga/imageGeometry";
import { positionRegion, mergeRegions } from "../../shared/manga/result";
import {
  saveMangaJob,
  getMangaCache,
  putMangaCache,
  pruneMangaJobs,
} from "../../shared/manga/store";
import { putImageAsset } from "../../shared/imageAssets";
import { t } from "../../shared/i18n";
import { AstraError } from "../../background/errors";
import {
  acquireMangaImage,
  encodeMangaTile,
  regionBackground,
  digest,
} from "./imagePipeline";
import { translateMangaTile } from "./mangaVisionClient";
import { MangaAdaptiveConcurrency } from "../../shared/manga/mangaAdaptiveConcurrency";
interface RunningJob {
  job: MangaJob;
  request: MangaExecution | null;
  abort: AbortController;
  rateLimitRetries?: number;
}
const jobs = new Map<string, RunningJob>();
const queue: string[] = [];
let running = 0;
let onIdle = () => {};
export function onMangaIdle(listener: () => void) {
  onIdle = listener;
}
export async function cancelMangaTab(prefix: string) {
  for (const entry of jobs.values())
    if (entry.job.owner.startsWith(prefix))
      await cancelMangaJob(entry.job.id, entry.job.owner);
}
export function activeMangaJobs() {
  return [...jobs.values()]
    .filter((entry) => MANGA_ACTIVE_PHASES.has(entry.job.phase))
    .map((entry) => entry.job.id);
}
export function mangaJobStatus(id: string, owner: string) {
  const entry = jobs.get(id);
  return entry?.job.owner === owner ? structuredClone(entry.job) : undefined;
}
async function publish(entry: RunningJob, changes: Partial<MangaJob>) {
  if (entry.job.phase === "cancelled" && changes.phase !== "cancelled") return;
  Object.assign(entry.job, changes, {
    revision: entry.job.revision + 1,
    updatedAt: Date.now(),
  });
  await saveMangaJob(entry.job).catch(() =>
    console.warn("[Astra Manga] Task state could not be persisted."),
  );
}
let configuredConcurrency = 3;
const adaptive = new MangaAdaptiveConcurrency({ max: configuredConcurrency });
let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

export function setMangaConcurrency(concurrency: number) {
  if (concurrency >= 1 && concurrency <= 8) {
    configuredConcurrency = concurrency;
    adaptive.setMax(concurrency);
    pump();
  }
}
export async function startMangaJob(request: MangaExecution) {
  if (request.concurrency && request.concurrency >= 1 && request.concurrency <= 8) {
    configuredConcurrency = request.concurrency;
    adaptive.setMax(request.concurrency);
  }
  const maxActive = Math.max(12, configuredConcurrency * 3);
  if (activeMangaJobs().length >= maxActive) throw new Error("MANGA_BUSY");
  if (jobs.has(request.job.id)) return;
  await saveMangaJob(request.job);
  jobs.set(request.job.id, {
    job: request.job,
    request,
    abort: new AbortController(),
  });
  if (request.priority === "high") {
    queue.unshift(request.job.id);
  } else {
    queue.push(request.job.id);
  }
  pump();
}
export async function cancelMangaJob(id: string, owner: string) {
  const entry = jobs.get(id);
  if (!entry || entry.job.owner !== owner) return false;
  if (MANGA_ACTIVE_PHASES.has(entry.job.phase)) {
    entry.abort.abort();
    await publish(entry, {
      phase: "cancelled",
      error: undefined,
      errorCode: "CANCELLED",
    });
    if (entry.job.completed === 0 && queue.includes(id)) entry.request = null;
  }
  return true;
}
function pump() {
  const remaining = adaptive.cooldownRemainingMs();
  if (remaining > 0) {
    if (!cooldownTimer) {
      cooldownTimer = setTimeout(() => {
        cooldownTimer = undefined;
        pump();
      }, remaining + 20);
    }
    return;
  }
  while (adaptive.canRun(running) && queue.length) {
    const nextId = queue.shift()!;
    const entry = jobs.get(nextId);
    if (!entry || entry.job.phase === "cancelled" || !entry.request) continue;
    running++;
    void execute(entry).finally(() => {
      running--;
      if (entry.job.phase !== "queued") {
        entry.request = null;
      }
      const idle = [...jobs.entries()].filter(
        ([, value]) => !MANGA_ACTIVE_PHASES.has(value.job.phase),
      );
      while (idle.length > 40) jobs.delete(idle.shift()![0]);
      void pruneMangaJobs().catch(() => {});
      pump();
      if (activeMangaJobs().length === 0) onIdle();
    });
  }
}
async function execute(entry: RunningJob) {
  const request = entry.request!;
  const { job } = entry;
  const { signal } = entry.abort;
  const deadline = setTimeout(() => entry.abort.abort(), 300_000);
  let bitmap: ImageBitmap | undefined;
  const check = () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  };
  try {
    await publish(entry, { phase: "loading" });
    check();
    const { blob, probeCode } = await acquireMangaImage(request.source, signal);
    check();
    const imageHash = await digest(blob);
    const authHash = await digest(
      JSON.stringify([
        request.provider.apiKey,
        Object.entries(request.provider.customHeaders ?? {}).sort(),
      ]),
    );
    const key = await digest(
      JSON.stringify([
        imageHash,
        MANGA_PROMPT_VERSION,
        request.provider.baseUrl,
        request.provider.endpoint,
        request.provider.model,
        request.targetLanguage,
        request.secondaryTargetLanguage ?? "",
        request.sameLanguageToSecondaryEnabled ?? false,
        request.glossary,
        authHash,
      ]),
    );
    if (!request.force && !job.probe) {
      const cached = await getMangaCache(key).catch(() => undefined);
      check();
      if (cached) {
        await publish(entry, {
          ...cached,
          phase: "ready",
          cacheHit: true,
          total: 1,
          completed: 1,
        });
        return;
      }
    }
    await publish(entry, { phase: "preparing" });
    check();
    bitmap = await createImageBitmap(blob);
    check();
    const tiles = planTiles(bitmap.width, bitmap.height);
    const assetId = await putImageAsset(blob, "manga:" + job.id);
    check();
    await publish(entry, {
      width: bitmap.width,
      height: bitmap.height,
      total: tiles.length,
      assetId,
    });
    for (const tile of tiles) {
      check();
      await publish(entry, { phase: "translating" });
      const input = await encodeMangaTile(bitmap, tile);
      check();
      const result = await translateMangaTile(
        request.provider,
        input.dataUrl,
        request.targetLanguage,
        request.glossary,
        request.language,
        signal,
        request.thinkingEffort,
        request.secondaryTargetLanguage,
        request.sameLanguageToSecondaryEnabled,
      );
      check();
      const positioned = result.regions.map((region) => {
        const value = positionRegion(region, tile);
        return {
          ...value,
          background: regionBackground(input.canvas, tile, value),
        };
      });
      input.canvas.width = 1;
      input.canvas.height = 1;
      const regions = mergeRegions(job.regions, positioned);
      if (regions.length > 600 || JSON.stringify(regions).length > 600_000)
        throw new Error("MANGA_TOO_LARGE");
      await publish(entry, {
        regions,
        format: result.format,
        completed: job.completed + 1,
      });
    }
    check();
    if (
      probeCode &&
      !job.regions
        .map((region) => region.sourceText)
        .join("")
        .replace(/\s/g, "")
        .toUpperCase()
        .includes(probeCode)
    )
      throw new Error("MANGA_VISION_FAILED");
    const result: MangaResult = {
      width: job.width,
      height: job.height,
      regions: job.regions,
      format: job.format ?? "",
    };
    if (!job.probe)
      await putMangaCache(key, result).catch(() =>
        console.warn("[Astra Manga] Result cache unavailable."),
      );
    check();
    await publish(entry, { phase: "ready", rateLimited: false });
    adaptive.onSuccess();
  } catch (error) {
    if (job.phase !== "cancelled") {
      const code = signal.aborted
        ? "TIMEOUT"
        : error instanceof AstraError
          ? error.code
          : error instanceof Error
            ? error.message
            : "MANGA_FAILED";
      const isRateLimit =
        code === "RATE_LIMIT" ||
        code === "429" ||
        (typeof error === "object" && (error as any)?.status === 429) ||
        /429|rate\s*limit|quota|resource.*exhausted/i.test(
          String(error instanceof Error ? error.message : error),
        );

      if (isRateLimit && (entry.rateLimitRetries ?? 0) < 3) {
        entry.rateLimitRetries = (entry.rateLimitRetries ?? 0) + 1;
        const retryAfterMs = (error as any)?.retryAfterMs;
        const delay = adaptive.onRateLimit(retryAfterMs);
        entry.abort = new AbortController();
        queue.unshift(entry.job.id);
        await publish(entry, {
          phase: "queued",
          rateLimited: true,
          error: t(request.language, "manga.rateLimitRetrying"),
        });
        if (!cooldownTimer) {
          cooldownTimer = setTimeout(() => {
            cooldownTimer = undefined;
            pump();
          }, delay + 20);
        }
        return;
      }

      const labels: Record<string, string> = {
        MANGA_SOURCE_UNREADABLE: "manga.sourceFailed",
        MANGA_TOO_LARGE: "manga.tooLarge",
        IMAGE_TOO_LARGE: "manga.tooLarge",
        MANGA_INVALID_RESULT: "manga.invalidResult",
        MANGA_VISION_FAILED: "manga.visionFailed",
        TIMEOUT: "error.timeout",
        RATE_LIMIT: "error.rateLimit",
      };
      const message = labels[code]
        ? t(request.language, labels[code])
        : error instanceof AstraError
          ? error.message
          : isRateLimit
            ? t(request.language, "error.rateLimit")
            : t(request.language, "manga.failed");
      await publish(entry, {
        phase: "failed",
        error: message,
        errorCode: isRateLimit ? "RATE_LIMIT" : code,
        rateLimited: false,
      });
    }
  } finally {
    clearTimeout(deadline);
    bitmap?.close();
  }
}
