// Client-side OCR using tesseract.js.
// All work happens in the browser — no server round-trip, no AI cost, no DB writes.

import type { Worker } from "tesseract.js";

type TableType = "soldiers" | "power" | "consumption";

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const w = await createWorker("eng", 1, {
        // keep tesseract quiet in prod
        logger: () => {},
      });
      await w.setParameters({
        tessedit_char_whitelist: "0123456789KMBkmb:+-.,",
        preserve_interword_spaces: "1",
      });
      return w;
    })();
  }
  return workerPromise;
}

// Downscale + light preprocess (grayscale + contrast) for faster OCR.
// Returns a compressed JPEG data URL suitable for both preview and OCR input.
export async function preprocessImage(
  file: File,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<{ dataUrl: string; canvas: HTMLCanvasElement }> {
  const maxDim = opts.maxDim ?? 1400;
  const quality = opts.quality ?? 0.82;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);

  // grayscale + contrast boost
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const contrast = 1.35;
  const intercept = 128 * (1 - contrast);
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, contrast * y + intercept));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);

  return { dataUrl: canvas.toDataURL("image/jpeg", quality), canvas };
}

// Crop a region of the (preprocessed) canvas.
export function cropRegion(
  canvas: HTMLCanvasElement,
  region: { y: number; h: number; x?: number; w?: number },
): HTMLCanvasElement {
  const sx = Math.floor((region.x ?? 0) * canvas.width);
  const sy = Math.floor(region.y * canvas.height);
  const sw = Math.floor((region.w ?? 1) * canvas.width);
  const sh = Math.floor(region.h * canvas.height);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

async function recognizeText(source: HTMLCanvasElement | string): Promise<string> {
  const w = await getWorker();
  const { data } = await w.recognize(source);
  return data.text ?? "";
}

// Parse "1,234", "1.5K", "2M", "3B" → number
export function parseCompact(raw: string): number {
  const s = raw.trim().replace(/,/g, "").replace(/\s+/g, "");
  const m = s.match(/^([\d.]+)\s*([KkMmBb])?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return NaN;
  const suf = m[2]?.toLowerCase();
  if (suf === "k") return n * 1_000;
  if (suf === "m") return n * 1_000_000;
  if (suf === "b") return n * 1_000_000_000;
  return n;
}

function findAllNumbers(text: string): number[] {
  const re = /(\d[\d.,]*\s*[KkMmBb]?)/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseCompact(m[1]);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

// Result shapes (match the previous server contract so caller code stays the same)
export type SoldiersResult = {
  rows: Array<{
    count: number | null;
    sign: "+" | "-" | null;
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  }>;
};
export type PowerResult = { soldiers: number; power: number };
export type ConsumptionResult = {
  batchSoldiers: number;
  wheat: number;
  wood: number;
  iron: number;
  silver: number;
  crystal: number;
};

function parseSoldiers(text: string): SoldiersResult {
  // Look for lines that contain a time like d:h:m:s or h:m:s
  const rows: SoldiersResult["rows"] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const time = line.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2}):(\d{2})|(\d{1,2}):(\d{2}):(\d{2})/);
    if (!time) continue;
    let days = 0, hours = 0, minutes = 0, seconds = 0;
    if (time[4] !== undefined) {
      days = time[1] ? +time[1] : 0;
      hours = +time[2];
      minutes = +time[3];
      seconds = +time[4];
    } else {
      hours = +time[5];
      minutes = +time[6];
      seconds = +time[7];
    }
    // number before the time on same line
    const beforeTime = line.slice(0, time.index).trim();
    const nums = findAllNumbers(beforeTime);
    const count = nums.length ? Math.round(nums[nums.length - 1]) : null;
    const sign: "+" | "-" | null = /-\s*\d/.test(beforeTime) ? "-" : "+";
    rows.push({ count, sign, days, hours, minutes, seconds });
  }
  return { rows };
}

function parsePower(text: string): PowerResult {
  // Power: largest number that follows a '+' in the text.
  let power = 0;
  const plusRe = /\+\s*([\d.,]+\s*[KkMmBb]?)/g;
  let m: RegExpExecArray | null;
  while ((m = plusRe.exec(text))) {
    const n = parseCompact(m[1]);
    if (Number.isFinite(n) && n > power) power = n;
  }
  // soldiers: pick the smallest realistic count number (1..10_000_000) that is NOT the power value.
  const nums = findAllNumbers(text).filter((n) => n !== power && n >= 1 && n <= 10_000_000);
  nums.sort((a, b) => a - b);
  const soldiers = nums[0] ?? 0;
  return { soldiers, power };
}

function parseConsumption(text: string): ConsumptionResult {
  const nums = findAllNumbers(text);
  // Expect 5 resources (wheat, wood, iron, silver, crystal) + batch soldiers somewhere.
  // Heuristic: take the last 6 numbers; resources first (largest usually), soldiers last.
  const tail = nums.slice(-6);
  const [wheat = 0, wood = 0, iron = 0, silver = 0, crystal = 0, batch = 0] =
    tail.length >= 6 ? tail : [0, 0, 0, 0, 0, ...tail];
  return {
    batchSoldiers: Math.round(batch),
    wheat,
    wood,
    iron,
    silver,
    crystal,
  };
}

export async function ocrExtractClient(
  file: File,
  table: TableType,
): Promise<{
  previewDataUrl: string;
  result: SoldiersResult | PowerResult | ConsumptionResult;
}> {
  const { dataUrl, canvas } = await preprocessImage(file);

  // crop by table type — traditional OCR benefits from targeted regions
  let region: HTMLCanvasElement;
  if (table === "soldiers") region = cropRegion(canvas, { y: 0.5, h: 0.5 });
  else if (table === "power") region = cropRegion(canvas, { y: 0.25, h: 0.7 });
  else region = cropRegion(canvas, { y: 0.5, h: 0.5 });

  const text = await recognizeText(region);

  let result: SoldiersResult | PowerResult | ConsumptionResult;
  if (table === "soldiers") result = parseSoldiers(text);
  else if (table === "power") result = parsePower(text);
  else result = parseConsumption(text);

  return { previewDataUrl: dataUrl, result };
}
