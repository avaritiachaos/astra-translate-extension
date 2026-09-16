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
interface RunningJob {
  job: MangaJob;
  request: MangaExecution | null;
  abort: AbortController;
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
export function setMangaConcurrency(concurrency: number) {
  if (concurrency >= 1 && concurrency <= 8) {
    configuredConcurrency = concurrency;
    pump();
  }
}
export async function startMangaJob(request: MangaExecution) {
  if (request.concurrency && request.concurrency >= 1 && request.concurrency <= 8) {
    configuredConcurrency = request.concurrency;
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
  while (running < configuredConcurrency && queue.length) {
    const entry = jobs.get(queue.shift()!);
    if (!entry || entry.job.phase === "cancelled" || !entry.request) continue;
    running++;
    void execute(entry).finally(() => {
      running--;
      entry.request = null;
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
    await publish(entry, { phase: "ready" });
  } catch (error) {
    if (job.phase !== "cancelled") {
      const code = signal.aborted
        ? "TIMEOUT"
        : error instanceof AstraError
          ? error.code
          : error instanceof Error
            ? error.message
            : "MANGA_FAILED";
      const labels: Record<string, string> = {
        MANGA_SOURCE_UNREADABLE: "manga.sourceFailed",
        MANGA_TOO_LARGE: "manga.tooLarge",
        IMAGE_TOO_LARGE: "manga.tooLarge",
        MANGA_INVALID_RESULT: "manga.invalidResult",
        MANGA_VISION_FAILED: "manga.visionFailed",
        TIMEOUT: "error.timeout",
      };
      const message = labels[code]
        ? t(request.language, labels[code])
        : error instanceof AstraError
          ? error.message
          : t(request.language, "manga.failed");
      await publish(entry, {
        phase: "failed",
        error: message,
        errorCode: code,
      });
    }
  } finally {
    clearTimeout(deadline);
    bitmap?.close();
  }
}
