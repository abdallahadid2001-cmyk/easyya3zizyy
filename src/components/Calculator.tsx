import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { translations, type Lang } from "@/lib/i18n";
import { formatBigUnit, formatHours, formatNumber, normalizeDigits, parseNum } from "@/lib/numbers";
import { ocrExtractClient } from "@/lib/ocr-client";

type RowKey = "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "8h" | "12h" | "24h";

const ROWS: { key: RowKey; minutes: number; labelKey: keyof typeof translations.ar }[] = [
  { key: "1m", minutes: 1, labelKey: "cat1m" },
  { key: "5m", minutes: 5, labelKey: "cat5m" },
  { key: "15m", minutes: 15, labelKey: "cat15m" },
  { key: "30m", minutes: 30, labelKey: "cat30m" },
  { key: "1h", minutes: 60, labelKey: "cat1h" },
  { key: "2h", minutes: 120, labelKey: "cat2h" },
  { key: "8h", minutes: 480, labelKey: "cat8h" },
  { key: "12h", minutes: 720, labelKey: "cat12h" },
  { key: "24h", minutes: 1440, labelKey: "cat24h" },
];

const STORAGE_KEY = "hours-calc-v4";

type RowVals = {
  free: string; training: string; suitcase?: string;
  freeMul: string; trainingMul: string; suitcaseMul?: string;
};
type BoxKey = "10kw" | "50kw" | "100kw" | "150k" | "500k" | "1_5m" | "5m" | "15m" | "50m";
const BOXES: { key: BoxKey; value: number; labelKey: keyof typeof translations.ar; woodOnly?: boolean }[] = [
  { key: "10kw", value: 10_000, labelKey: "box10kw", woodOnly: true },
  { key: "50kw", value: 50_000, labelKey: "box50kw", woodOnly: true },
  { key: "100kw", value: 100_000, labelKey: "box100kw", woodOnly: true },
  { key: "150k", value: 150_000, labelKey: "box150k" },
  { key: "500k", value: 500_000, labelKey: "box500k" },
  { key: "1_5m", value: 1_500_000, labelKey: "box1_5m" },
  { key: "5m", value: 5_000_000, labelKey: "box5m" },
  { key: "15m", value: 15_000_000, labelKey: "box15m" },
  { key: "50m", value: 50_000_000, labelKey: "box50m" },
];

// per-1-soldier default consumption rates (fallback when user hasn't entered batch numbers)
const CONSUMPTION_PER_SOLDIER = {
  wheat: 800, wood: 800, iron: 200, silver: 60, crystal: 0,
} as const;

type ResKey = keyof typeof CONSUMPTION_PER_SOLDIER;
const RES_ORDER: ResKey[] = ["wheat", "wood", "iron", "silver", "crystal"];

// Universal multipliers for any count input (hours / soldiers etc.)
const MUL_UNITS = [
  { v: "1", k: "mulRaw" as const },
  { v: "10", k: "mul10" as const },
  { v: "100", k: "mul100" as const },
  { v: "1000", k: "mulK" as const },
  { v: "100000", k: "mulK100" as const },
  { v: "1000000", k: "mulM" as const },
];

const DISCOUNTS = ["0", "20", "25", "30", "35", "40"];

type State = {
  rows: Record<RowKey, RowVals>;
  manualHours: string;
  manualHoursMul: string;
  trainingUnit: string;
  trainingUnitMul: string;
  trainDays: string;
  trainHours: string;
  trainMinutes: string;
  trainSeconds: string;
  manualSoldiers: string;
  manualSoldiersMul: string;
  powerSoldierUnit: string;
  powerSoldierUnitMul: string;
  powerValue: string;
  boxes: Record<BoxKey, string>;
  resource: "wood" | "wheat";
  // table 4 (consumption)
  consSoldierUnit: string;
  consSoldierUnitMul: string;
  consDiscount: string;
  consManual: Record<ResKey, string>;
  consManualMul: Record<ResKey, string>;
  tasarihImage: string | null;
  // OCR images for review
  ocrImg: { soldiers: string | null; power: string | null; consumption: string | null };
  ocrShow: { soldiers: boolean; power: boolean; consumption: boolean };
  ocrHeight: number;
  ocrZoom: number;
};

const emptyRow = (): RowVals => ({
  free: "", training: "", suitcase: "",
  freeMul: "1", trainingMul: "1", suitcaseMul: "1",
});
const initialState = (): State => ({
  rows: ROWS.reduce((acc, r) => { acc[r.key] = emptyRow(); return acc; }, {} as Record<RowKey, RowVals>),
  manualHours: "",
  manualHoursMul: "1",
  trainingUnit: "",
  trainingUnitMul: "1",
  trainDays: "",
  trainHours: "",
  trainMinutes: "",
  trainSeconds: "",
  manualSoldiers: "",
  manualSoldiersMul: "1",
  powerSoldierUnit: "",
  powerSoldierUnitMul: "1",
  powerValue: "",
  boxes: BOXES.reduce((acc, b) => { acc[b.key] = ""; return acc; }, {} as Record<BoxKey, string>),
  resource: "wood",
  consSoldierUnit: "",
  consSoldierUnitMul: "1",
  consDiscount: "0",
  consManual: { wheat: "", wood: "", iron: "", silver: "", crystal: "" },
  consManualMul: { wheat: "1", wood: "1", iron: "1", silver: "1", crystal: "1" },
  tasarihImage: null,
  ocrImg: { soldiers: null, power: null, consumption: null },
  ocrShow: { soldiers: true, power: true, consumption: true },
  ocrHeight: 220,
  ocrZoom: 1,
});

function useLocalState(): [State, React.Dispatch<React.SetStateAction<State>>] {
  const [state, setState] = useState<State>(() => {
    if (typeof window === "undefined") return initialState();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = initialState();
        const rows = { ...base.rows };
        if (parsed.rows) {
          for (const k of Object.keys(rows) as RowKey[]) {
            rows[k] = { ...base.rows[k], ...(parsed.rows[k] ?? {}) };
          }
        }
        return {
          ...base,
          ...parsed,
          rows,
          boxes: { ...base.boxes, ...(parsed.boxes ?? {}) },
          consManual: { ...base.consManual, ...(parsed.consManual ?? {}) },
          consManualMul: { ...base.consManualMul, ...(parsed.consManualMul ?? {}) },
          ocrImg: { ...base.ocrImg, ...(parsed.ocrImg ?? {}) },
          ocrShow: { ...base.ocrShow, ...(parsed.ocrShow ?? {}) },
        };
      }
    } catch {}
    return initialState();
  });
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);
  return [state, setState];
}

// crop helper
async function cropImage(file: File, region: "bottom" | "middle"): Promise<{ base64: string; mime: string; dataUrl: string }> {
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
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let sy = 0, sh = h;
  if (region === "bottom") { sy = Math.floor(h * 0.55); sh = h - sy; }
  else if (region === "middle") { sy = Math.floor(h * 0.30); sh = Math.floor(h * 0.40); }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = sh;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, sy, w, sh, 0, 0, w, sh);
  const outDataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const base64 = outDataUrl.split(",")[1];
  return { base64, mime: "image/jpeg", dataUrl };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// helper: effective value = raw * multiplier
const eff = (raw: string, mul: string) => parseNum(raw) * (parseNum(mul) || 1);
const formatCompactInput = (n: number) => String(Math.round(n * 100) / 100).replace(/\.0+$/, "");
const compactOcrNumber = (raw: unknown): { value: string; mul: string } => {
  const n = parseNum(raw as string | number | null | undefined);
  if (n >= 1_000_000) return { value: formatCompactInput(n / 1_000_000), mul: "1000000" };
  if (n >= 1_000) return { value: formatCompactInput(n / 1_000), mul: "1000" };
  return { value: n > 0 ? formatCompactInput(n) : "", mul: "1" };
};

export function Calculator({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = translations[lang];
  const isRTL = lang === "ar";
  const [state, setState] = useLocalState();
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | "soldiers" | "power" | "consumption">(null);
  const [tasarihHeight, setTasarihHeight] = useState<number>(220);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (window.localStorage.getItem("theme") as "light" | "dark") ?? "light";
  });
  

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { window.localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
  }, [lang, isRTL]);

  const markAi = (...keys: string[]) =>
    setAiFilled((prev) => { const n = new Set(prev); keys.forEach((k) => n.add(k)); return n; });
  const unmarkAi = (key: string) =>
    setAiFilled((prev) => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
  const aiCls = (k: string) =>
    aiFilled.has(k) ? "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/40" : "";

  // ===== Computations =====
  const rowHours = useMemo(() => {
    const out = {} as Record<RowKey, number>;
    for (const r of ROWS) {
      const v = state.rows[r.key];
      const free = eff(v.free, v.freeMul);
      const train = eff(v.training, v.trainingMul);
      const suit = r.key === "2h" ? eff(v.suitcase ?? "", v.suitcaseMul ?? "1") : 0;
      out[r.key] = ((free + train + suit) * r.minutes) / 60;
    }
    return out;
  }, [state.rows]);

  const totalHours = useMemo(
    () => Object.values(rowHours).reduce((a, b) => a + b, 0),
    [rowHours],
  );
  const totalDays = totalHours / 24;

  // Table 2
  const manualHoursEff = eff(state.manualHours, state.manualHoursMul);
  const effectiveHours = manualHoursEff > 0 ? manualHoursEff : totalHours;

  const trainingUnitEff = eff(state.trainingUnit, state.trainingUnitMul);
  const cycleHours = useMemo(() => {
    const d = parseNum(state.trainDays);
    const h = parseNum(state.trainHours);
    const m = parseNum(state.trainMinutes);
    const s = parseNum(state.trainSeconds);
    return d * 24 + h + m / 60 + s / 3600;
  }, [state.trainDays, state.trainHours, state.trainMinutes, state.trainSeconds]);

  const totalSoldiers = cycleHours > 0 ? (effectiveHours / cycleHours) * trainingUnitEff : 0;

  // Table 3
  const manualSoldiersEff = eff(state.manualSoldiers, state.manualSoldiersMul);
  const effectiveSoldiers = manualSoldiersEff > 0 ? manualSoldiersEff : totalSoldiers;
  const powerSoldierUnitEff = eff(state.powerSoldierUnit, state.powerSoldierUnitMul);
  const powerValueNum = parseNum(state.powerValue);
  const totalPower = powerSoldierUnitEff > 0 ? (effectiveSoldiers / powerSoldierUnitEff) * powerValueNum : 0;

  // Table 4 — consumption
  const consSoldierEff = eff(state.consSoldierUnit, state.consSoldierUnitMul);
  const discountPct = parseNum(state.consDiscount);
  const discountMul = 1 - discountPct / 100;
  const consPerSoldier: Record<ResKey, number> = useMemo(() => {
    const out = {} as Record<ResKey, number>;
    for (const k of RES_ORDER) {
      const manualEff = eff(state.consManual[k], state.consManualMul[k]);
      if (manualEff > 0 && consSoldierEff > 0) {
        out[k] = manualEff / consSoldierEff;
      } else {
        out[k] = CONSUMPTION_PER_SOLDIER[k];
      }
    }
    return out;
  }, [state.consManual, state.consManualMul, consSoldierEff]);
  const consTotal: Record<ResKey, number> = useMemo(() => {
    const out = {} as Record<ResKey, number>;
    for (const k of RES_ORDER) out[k] = consPerSoldier[k] * effectiveSoldiers * discountMul;
    return out;
  }, [consPerSoldier, effectiveSoldiers, discountMul]);
  const isConsumptionReady = consSoldierEff > 0 && RES_ORDER.every((k) => eff(state.consManual[k], state.consManualMul[k]) > 0);

  const updateCell = (key: RowKey, field: "free" | "training" | "suitcase", raw: string) => {
    const cleaned = normalizeDigits(raw);
    setState((s) => ({ ...s, rows: { ...s.rows, [key]: { ...s.rows[key], [field]: cleaned } } }));
  };
  const updateCellMul = (key: RowKey, field: "freeMul" | "trainingMul" | "suitcaseMul", val: string) => {
    setState((s) => ({ ...s, rows: { ...s.rows, [key]: { ...s.rows[key], [field]: val } } }));
  };

  const clearAll = () => {
    setState(initialState());
    setAiFilled(new Set());
  };

  const copyTotal = async () => {
    try { await navigator.clipboard.writeText(formatHours(totalHours)); showToast(t.copied); } catch {}
  };

  const exportExcel = () => {
    const sheet1 = [
      [t.colCategory, t.free, t.training, t.suitcase, t.colHours],
      ...ROWS.map((r) => {
        const v = state.rows[r.key];
        return [
          t[r.labelKey],
          eff(v.free, v.freeMul),
          eff(v.training, v.trainingMul),
          r.key === "2h" ? eff(v.suitcase ?? "", v.suitcaseMul ?? "1") : "",
          Math.round(rowHours[r.key] * 100) / 100,
        ];
      }),
      ["", "", "", t.totalHours, Math.round(totalHours * 100) / 100],
      ["", "", "", t.totalDays, Math.round(totalDays * 100) / 100],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), "Hours");
    XLSX.writeFile(wb, "calculator.xlsx");
  };

  // ===== OCR handlers =====
  const setOcrImg = (tab: "soldiers" | "power" | "consumption", dataUrl: string) =>
    setState((s) => ({
      ...s,
      ocrImg: { ...s.ocrImg, [tab]: dataUrl },
      ocrShow: { ...s.ocrShow, [tab]: true },
    }));
  const toggleOcrShow = (tab: "soldiers" | "power" | "consumption") =>
    setState((s) => ({ ...s, ocrShow: { ...s.ocrShow, [tab]: !s.ocrShow[tab] } }));

  const handleSoldiersImage = async (file: File) => {
    setBusy("soldiers");
    try {
      const { base64, mime, dataUrl } = await cropImage(file, "bottom");
      setOcrImg("soldiers", dataUrl);
      // Try up to 3 attempts: cropped, cropped again, then full image
      const fullFull = await fileToDataUrl(file);
      const fullBase64 = fullFull.split(",")[1];
      const attempts: { b: string; m: string }[] = [
        { b: base64, m: mime },
        { b: base64, m: mime },
        { b: fullBase64, m: file.type || "image/jpeg" },
      ];
      let row: any = null;
      for (const a of attempts) {
        try {
          const out: any = await ocr({ data: { imageBase64: a.b, mime: a.m, table: "soldiers" } });
          const r = Array.isArray(out?.rows) ? out.rows[0] : null;
          if (r && (r.count != null || r.days != null || r.hours != null || r.minutes != null || r.seconds != null)) {
            row = r;
            break;
          }
        } catch (e) {
          console.error("OCR attempt failed", e);
        }
      }
      if (row) {
        setState((s) => ({
          ...s,
          trainingUnit: row.count != null ? String(Math.max(1, Math.round(row.count))) : s.trainingUnit,
          trainingUnitMul: "1",
          trainDays: row.days != null ? String(row.days) : s.trainDays,
          trainHours: row.hours != null ? String(row.hours) : s.trainHours,
          trainMinutes: row.minutes != null ? String(row.minutes) : s.trainMinutes,
          trainSeconds: row.seconds != null ? String(row.seconds) : s.trainSeconds,
        }));
        markAi("t2.unit", "t2.days", "t2.hours", "t2.minutes", "t2.seconds");
      } else {
        showToast(t.aiError);
      }
    } catch (e) {
      console.error(e);
      showToast(t.aiError);
    } finally {
      setBusy(null);
    }
  };


  const handlePowerImage = async (file: File) => {
    setBusy("power");
    try {
      const { base64, mime, dataUrl } = await cropImage(file, "middle");
      const bottom = await cropImage(file, "bottom");
      setOcrImg("power", dataUrl);
      const fullFull = await fileToDataUrl(file);
      const fullBase64 = fullFull.split(",")[1];
      const attempts: { b: string; m: string }[] = [
        { b: bottom.base64, m: bottom.mime },
        { b: fullBase64, m: file.type || "image/jpeg" },
        { b: base64, m: mime },
        { b: bottom.base64, m: bottom.mime },
      ];
      let val = 0;
      let soldiers = 0;
      for (const a of attempts) {
        try {
          const out: any = await ocr({ data: { imageBase64: a.b, mime: a.m, table: "power" } });
          const v = parseNum(out?.power);
          const s = parseNum(out?.soldiers);
          if (v > val) val = v;
          if (s > 0 && soldiers <= 0) soldiers = s;
          if (val > 0 && soldiers > 0) break;
        } catch (e) {
          console.error("Power OCR attempt failed", e);
        }
      }
      const filled: string[] = [];
      if (val > 0 || soldiers > 0) {
        setState((s) => ({
          ...s,
          powerValue: val > 0 ? String(val) : s.powerValue,
          powerSoldierUnit: soldiers > 0 ? String(Math.round(soldiers)) : s.powerSoldierUnit,
          powerSoldierUnitMul: soldiers > 0 ? "1" : s.powerSoldierUnitMul,
        }));
        if (val > 0) filled.push("t3.power");
        if (soldiers > 0) filled.push("t3.unit");
        markAi(...filled);
      } else {
        showToast(t.aiError);
      }
    } catch (e) {
      console.error(e);
      showToast(t.aiError);
    } finally {
      setBusy(null);
    }
  };


  const handleConsumptionImage = async (file: File) => {
    setBusy("consumption");
    try {
      const { base64, mime, dataUrl } = await cropImage(file, "bottom");
      setOcrImg("consumption", dataUrl);
      const out: any = await ocr({ data: { imageBase64: base64, mime, table: "consumption" } });
      const compact = {
        wheat: compactOcrNumber(out?.wheat),
        wood: compactOcrNumber(out?.wood),
        iron: compactOcrNumber(out?.iron),
        silver: compactOcrNumber(out?.silver),
        crystal: compactOcrNumber(out?.crystal),
      } as Record<ResKey, { value: string; mul: string }>;
      const next: Record<ResKey, string> = {
        wheat: compact.wheat.value,
        wood: compact.wood.value,
        iron: compact.iron.value,
        silver: compact.silver.value,
        crystal: compact.crystal.value,
      };
      const filledKeys: string[] = [];
      RES_ORDER.forEach((k) => { if (next[k]) filledKeys.push(`t4.${k}`); });
      const batch = parseNum(out?.batchSoldiers);
      if (filledKeys.length === 0 && batch <= 0) { showToast(t.aiError); return; }
      const nextMul: Record<ResKey, string> = { ...state.consManualMul };
      RES_ORDER.forEach((k) => { if (next[k]) nextMul[k] = compact[k].mul; });
      setState((s) => ({
        ...s,
        consManual: { ...s.consManual, ...next },
        consManualMul: nextMul,
        consSoldierUnit: batch > 0 ? String(Math.round(batch)) : s.consSoldierUnit,
        consSoldierUnitMul: batch > 0 ? "1" : s.consSoldierUnitMul,
      }));
      if (batch > 0) filledKeys.push("t4.unit");
      markAi(...filledKeys);
    } catch (e) {
      console.error(e);
      showToast(t.aiError);
    } finally {
      setBusy(null);
    }
  };

  const handleTasarihUpload = async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    setState((s) => ({ ...s, tasarihImage: dataUrl }));
  };

  const tabs = [t.tab1Short, t.tab2Short, t.tab3Short, t.tab4Short, t.tab5Short];

  // Small reusable multiplier select
  const MulSelect = ({
    value, onChange, aiKey, list = MUL_UNITS, extraCls = "",
  }: {
    value: string;
    onChange: (v: string) => void;
    aiKey?: string;
    list?: typeof MUL_UNITS;
    extraCls?: string;
  }) => (
    <select
      className={`num-input compact !w-auto !px-1 !text-[10px] ${extraCls} ${aiKey ? aiCls(aiKey) : ""}`}
      value={value}
      onChange={(e) => { if (aiKey) unmarkAi(aiKey); onChange(e.target.value); }}
    >
      {list.map((u) => (
        <option key={u.v} value={u.v}>{t[u.k]}</option>
      ))}
    </select>
  );

  return (
    <div className="min-h-screen pb-24">
      {/* Sticky top: tasarih image splitter (table 1 only) */}
      {activeTab === 0 && state.tasarihImage && (
        <TasarihSplit
          src={state.tasarihImage}
          height={tasarihHeight}
          onHeightChange={setTasarihHeight}
          onClose={() => setState((s) => ({ ...s, tasarihImage: null }))}
          removeLabel={t.removeImage}
        />
      )}

      <main className="mx-auto max-w-md space-y-3 px-3 pt-3">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="btn btn-ghost px-3 text-[12px]">
            {t.langToggle}
          </button>
          <div className="text-center">
            <div className="text-[13px] font-extrabold text-brand" style={{ fontFamily: "'Amiri','Scheherazade New',serif" }}>
              {t.bismillah}
            </div>
            <div className="mt-0.5 text-[9px] font-bold text-muted-foreground">{t.credit}</div>
          </div>
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="btn btn-ghost px-3 text-[14px]">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>

        {/* Tabs */}
        <nav className="card-grad grid grid-cols-5 gap-1 p-1">
          {tabs.map((label, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i as 0 | 1 | 2 | 3 | 4)}
              className={`rounded-lg px-1 py-2 text-[10px] font-extrabold leading-tight transition ${
                activeTab === i
                  ? "bg-[color-mix(in_oklab,var(--brand)_22%,transparent)] text-brand"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {aiFilled.size > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-400/60 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span>{t.aiFilled}</span>
            <button onClick={() => setAiFilled(new Set())} className="btn btn-secondary !py-1 text-[10px]">
              {t.confirmAll}
            </button>
          </div>
        )}

        {/* TABLE 1 */}
        {activeTab === 0 && (
        <section className="card-grad overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <h2 className="text-sm font-extrabold">{t.table1Title}</h2>
            <label className="btn btn-secondary cursor-pointer !py-1 text-[10px]">
              {state.tasarihImage ? t.removeImage : t.uploadTasarih}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onClick={(e) => {
                  if (state.tasarihImage) {
                    e.preventDefault();
                    setState((s) => ({ ...s, tasarihImage: null }));
                  }
                }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleTasarihUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          <div className="px-2 py-2">
            <div
              className="grid items-stretch gap-1.5 text-center text-[11px] font-bold text-muted-foreground"
              style={{ gridTemplateColumns: "minmax(0,0.7fr) minmax(0,1.9fr) minmax(0,0.9fr)" }}
            >
              <div className="py-1">{t.colCategory}</div>
              <div className="py-1 leading-tight">{t.colCount}</div>
              <div className="py-1">{t.colHours}</div>
            </div>

            <div className="mt-1 space-y-1.5">
              {ROWS.map((r) => {
                const v = state.rows[r.key];
                const is2h = r.key === "2h";
                const label = t[r.labelKey];
                return (
                  <div
                    key={r.key}
                    className="grid items-center gap-1.5 rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] px-1.5 py-1.5"
                    style={{ gridTemplateColumns: "minmax(0,0.7fr) minmax(0,1.9fr) minmax(0,0.9fr)" }}
                  >
                    <div className="min-w-0 truncate text-center text-[12px] font-bold">{label}</div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <span className="cell-label">{t.free}</span>
                        <input
                          inputMode="decimal"
                          className="num-input compact min-w-0 flex-1"
                          value={v.free}
                          onChange={(e) => updateCell(r.key, "free", e.target.value)}
                          placeholder="0"
                        />
                        <MulSelect value={v.freeMul} onChange={(val) => updateCellMul(r.key, "freeMul", val)} extraCls="shrink-0" />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="cell-label">{t.training}</span>
                        <input
                          inputMode="decimal"
                          className="num-input compact min-w-0 flex-1"
                          value={v.training}
                          onChange={(e) => updateCell(r.key, "training", e.target.value)}
                          placeholder="0"
                        />
                        <MulSelect value={v.trainingMul} onChange={(val) => updateCellMul(r.key, "trainingMul", val)} extraCls="shrink-0" />
                      </div>
                      {is2h && (
                        <div className="flex items-center gap-1">
                          <span className="cell-label">{t.suitcase}</span>
                          <input
                            inputMode="decimal"
                            className="num-input compact min-w-0 flex-1"
                            value={v.suitcase ?? ""}
                            onChange={(e) => updateCell(r.key, "suitcase", e.target.value)}
                            placeholder="0"
                          />
                          <MulSelect value={v.suitcaseMul ?? "1"} onChange={(val) => updateCellMul(r.key, "suitcaseMul", val)} extraCls="shrink-0" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 truncate text-center text-[13px] font-bold tabular-nums" dir="ltr">
                      {formatHours(rowHours[r.key])}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              className="mt-2 grid items-center gap-1.5 rounded-xl px-2 py-2 text-center"
              style={{
                gridTemplateColumns: "minmax(0,0.7fr) minmax(0,1.9fr) minmax(0,0.9fr)",
                background: "color-mix(in oklab, var(--brand) 14%, transparent)",
              }}
            >
              <div className="text-[12px] font-extrabold">{t.totalHours}</div>
              <div className="text-[12px] font-bold text-muted-foreground">—</div>
              <div className="text-[18px] font-extrabold text-brand tabular-nums" dir="ltr">{formatHours(totalHours)}</div>
            </div>
            <div
              className="mt-1.5 grid items-center gap-1.5 rounded-xl px-2 py-2 text-center"
              style={{
                gridTemplateColumns: "minmax(0,0.7fr) minmax(0,1.9fr) minmax(0,0.9fr)",
                background: "color-mix(in oklab, var(--success) 18%, transparent)",
              }}
            >
              <div className="text-[12px] font-extrabold">{t.totalDays}</div>
              <div className="text-[12px] font-bold text-muted-foreground">—</div>
              <div className="text-[18px] font-extrabold tabular-nums" style={{ color: "var(--success)" }} dir="ltr">
                {formatHours(totalDays)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 border-t border-border bg-[color-mix(in_oklab,var(--surface-2)_60%,transparent)] p-2">
            <button onClick={clearAll} className="btn btn-danger text-[12px]">{t.clearAll}</button>
            <button onClick={copyTotal} className="btn btn-secondary text-[12px]">{t.copyTotal}</button>
            <button onClick={exportExcel} className="btn btn-primary text-[12px]">{t.exportExcel}</button>
          </div>
        </section>
        )}

        {/* TABLE 2 */}
        {activeTab === 1 && (
        <section className="card-grad overflow-hidden">
          <div className="border-b border-border px-3 py-2.5">
            <h2 className="whitespace-pre-line text-sm font-extrabold leading-tight">{t.table2Title}</h2>
            <p className="mt-1 text-[10px] font-bold text-muted-foreground">{t.soldiersNote}</p>
          </div>
          <ImageUpload
            label={t.sendScreenshot}
            busy={busy === "soldiers"}
            busyLabel={t.processing}
            onFile={handleSoldiersImage}
          />
          <OcrImageReview
            src={state.ocrImg.soldiers}
            show={state.ocrShow.soldiers}
            onToggle={() => toggleOcrShow("soldiers")}
            height={state.ocrHeight}
            onHeightChange={(h) => setState((s) => ({ ...s, ocrHeight: h }))}
            zoom={state.ocrZoom}
            onZoomChange={(z) => setState((s) => ({ ...s, ocrZoom: z }))}
            labels={{ show: t.showImage, hide: t.hideImage }}
          />
          <div className="space-y-2 p-2.5">
            {/* Row 1: soldier count per cycle */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2.5">
              <div className="mb-1.5 text-[10px] font-bold text-muted-foreground">{t.soldier}</div>
              <div className="flex items-center gap-1.5">
                <input
                  inputMode="decimal"
                  className={`num-input compact flex-1 min-w-0 !text-[13px] ${aiCls("t2.unit")}`}
                  value={state.trainingUnit}
                  placeholder={t.enterSoldiers}
                  onChange={(e) => { unmarkAi("t2.unit"); setState((s) => ({ ...s, trainingUnit: normalizeDigits(e.target.value) })); }}
                />
                <MulSelect value={state.trainingUnitMul} onChange={(v) => setState((s) => ({ ...s, trainingUnitMul: v }))} extraCls="shrink-0" />
              </div>
            </div>

            {/* Row 2: training time */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2.5">
              <div className="mb-1.5 text-[10px] font-bold text-muted-foreground">{t.trainingSpeed}</div>
              <div className="grid grid-cols-4 gap-1.5">
                {(["Days", "Hours", "Minutes", "Seconds"] as const).map((unit) => {
                  const map = { Days: "trainDays", Hours: "trainHours", Minutes: "trainMinutes", Seconds: "trainSeconds" } as const;
                  const aiMap = { Days: "t2.days", Hours: "t2.hours", Minutes: "t2.minutes", Seconds: "t2.seconds" } as const;
                  const phMap = { Days: t.days, Hours: t.hoursLbl, Minutes: t.minutesLbl, Seconds: t.secondsLbl } as const;
                  const fieldKey = map[unit];
                  const aiKey = aiMap[unit];
                  return (
                    <div key={unit} className="flex flex-col items-center gap-0.5">
                      <input
                        inputMode="numeric"
                        className={`num-input compact w-full !text-[12px] text-center ${aiCls(aiKey)}`}
                        value={state[fieldKey]}
                        placeholder="0"
                        onChange={(e) => {
                          unmarkAi(aiKey);
                          const v = normalizeDigits(e.target.value);
                          setState((s) => ({ ...s, [fieldKey]: v }) as State);
                        }}
                      />
                      <span className="text-[9px] font-bold text-muted-foreground">{phMap[unit]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 3: hours */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted-foreground">{t.hoursCount}</span>
                <span className="rounded-md bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] px-2 py-0.5 text-[10px] font-extrabold tabular-nums" dir="ltr">
                  {t.autoLinked}: {formatHours(totalHours)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  inputMode="decimal"
                  className="num-input compact flex-1 min-w-0 !text-[13px]"
                  value={state.manualHours}
                  placeholder={t.manualHours}
                  onChange={(e) => setState((s) => ({ ...s, manualHours: normalizeDigits(e.target.value) }))}
                />
                <MulSelect value={state.manualHoursMul} onChange={(v) => setState((s) => ({ ...s, manualHoursMul: v }))} extraCls="shrink-0" />
              </div>
            </div>

            {/* Total: full width at bottom */}
            <div
              className="rounded-xl px-3 py-3 text-center"
              style={{ background: "color-mix(in oklab, var(--brand) 18%, transparent)" }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t.totalSoldiers}</div>
              <div className="mt-1 text-[22px] font-extrabold text-brand" dir="ltr">{formatBigUnit(totalSoldiers, lang)}</div>
              <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground" dir="ltr">{formatNumber(Math.round(totalSoldiers))}</div>
            </div>
          </div>

        </section>
        )}

        {/* TABLE 3 */}
        {activeTab === 2 && (
        <section className="card-grad overflow-hidden">
          <div className="border-b border-border px-3 py-2.5">
            <h2 className="whitespace-pre-line text-sm font-extrabold leading-tight">{t.table3Title}</h2>
          </div>
          <div className="mx-3 mt-2 rounded-lg border-2 border-amber-500/70 bg-amber-50 px-2.5 py-2 text-[11px] font-extrabold leading-snug text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            ⚠ {t.powerNote}
          </div>
          <ImageUpload
            label={t.sendScreenshot}
            busy={busy === "power"}
            busyLabel={t.processing}
            onFile={handlePowerImage}
          />
          <OcrImageReview
            src={state.ocrImg.power}
            show={state.ocrShow.power}
            onToggle={() => toggleOcrShow("power")}
            height={state.ocrHeight}
            onHeightChange={(h) => setState((s) => ({ ...s, ocrHeight: h }))}
            zoom={state.ocrZoom}
            onZoomChange={(z) => setState((s) => ({ ...s, ocrZoom: z }))}
            labels={{ show: t.showImage, hide: t.hideImage }}
          />
          <div className="space-y-2 p-2.5">
            {/* Row 1: soldier count */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted-foreground">{t.soldiersCount}</span>
                <span className="rounded-md bg-[color-mix(in_oklab,var(--brand)_12%,transparent)] px-2 py-0.5 text-[10px] font-extrabold tabular-nums" dir="ltr">
                  {t.autoLinked}: {formatBigUnit(totalSoldiers, lang)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  inputMode="decimal"
                  className="num-input compact flex-1 min-w-0 !text-[13px]"
                  value={state.manualSoldiers}
                  placeholder={t.manualSoldiers}
                  onChange={(e) => setState((s) => ({ ...s, manualSoldiers: normalizeDigits(e.target.value) }))}
                />
                <MulSelect value={state.manualSoldiersMul} onChange={(v) => setState((s) => ({ ...s, manualSoldiersMul: v }))} extraCls="shrink-0" />
              </div>
            </div>

            {/* Row 2: per-unit soldier */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2.5">
              <div className="mb-1.5 text-[10px] font-bold text-muted-foreground">{t.soldier}</div>
              <div className="flex items-center gap-1.5">
                <input
                  inputMode="decimal"
                  className={`num-input compact flex-1 min-w-0 !text-[13px] ${aiCls("t3.unit")}`}
                  value={state.powerSoldierUnit}
                  placeholder={t.enterSoldiers}
                  onChange={(e) => { unmarkAi("t3.unit"); setState((s) => ({ ...s, powerSoldierUnit: normalizeDigits(e.target.value) })); }}
                />
                <MulSelect value={state.powerSoldierUnitMul} onChange={(v) => setState((s) => ({ ...s, powerSoldierUnitMul: v }))} extraCls="shrink-0" />
              </div>
            </div>

            {/* Row 3: power value */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2.5">
              <div className="mb-1.5 text-[10px] font-bold text-muted-foreground">{t.powerValue}</div>
              <input
                inputMode="decimal"
                className={`num-input compact w-full !text-[13px] ${aiCls("t3.power")}`}
                value={state.powerValue}
                placeholder={t.powerUnitFree}
                onChange={(e) => { unmarkAi("t3.power"); setState((s) => ({ ...s, powerValue: normalizeDigits(e.target.value) })); }}
              />
            </div>

            {/* Total: full width */}
            <div
              className="rounded-xl px-3 py-3 text-center"
              style={{ background: "color-mix(in oklab, var(--brand) 18%, transparent)" }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t.powerIncrease}</div>
              <div className="mt-1 text-[22px] font-extrabold text-brand" dir="ltr">{formatBigUnit(totalPower, lang)}</div>
              <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground" dir="ltr">{formatNumber(Math.round(totalPower))}</div>
            </div>
          </div>

        </section>
        )}

        {/* TABLE 4 — Consumption */}
        {activeTab === 3 && (
        <section className="card-grad overflow-hidden">
          <div className="border-b border-border px-3 py-2.5">
            <h2 className="text-sm font-extrabold">{t.table4Title}</h2>
            <p className="mt-1 text-[10px] font-bold text-muted-foreground">{t.consumptionNote}</p>
          </div>
          <ImageUpload
            label={t.sendScreenshot}
            busy={busy === "consumption"}
            busyLabel={t.processing}
            onFile={handleConsumptionImage}
          />
          <OcrImageReview
            src={state.ocrImg.consumption}
            show={state.ocrShow.consumption}
            onToggle={() => toggleOcrShow("consumption")}
            height={state.ocrHeight}
            onHeightChange={(h) => setState((s) => ({ ...s, ocrHeight: h }))}
            zoom={state.ocrZoom}
            onZoomChange={(z) => setState((s) => ({ ...s, ocrZoom: z }))}
            labels={{ show: t.showImage, hide: t.hideImage }}
          />
          <div className="space-y-2 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-center text-[9px] font-bold text-muted-foreground">{t.soldierCount}</div>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    inputMode="decimal"
                    className={`num-input compact ${aiCls("t4.unit")}`}
                    value={state.consSoldierUnit}
                    placeholder={t.enterSoldiers}
                    onChange={(e) => { unmarkAi("t4.unit"); setState((s) => ({ ...s, consSoldierUnit: normalizeDigits(e.target.value) })); }}
                  />
                  <MulSelect value={state.consSoldierUnitMul} onChange={(v) => setState((s) => ({ ...s, consSoldierUnitMul: v }))} />
                </div>
              </div>
              <div>
                <div className="text-center text-[9px] font-bold text-muted-foreground">{t.discount}</div>
                <select
                  className="num-input compact mt-1"
                  value={state.consDiscount}
                  onChange={(e) => setState((s) => ({ ...s, consDiscount: e.target.value }))}
                >
                  {DISCOUNTS.map((d) => (
                    <option key={d} value={d}>{d === "0" ? t.noDiscount : `${d}%`}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* batch consumption inputs */}
            <div className="rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] p-2">
              <div className="grid grid-cols-2 gap-2">
                {(["wheat", "wood"] as const).map((k) => (
                  <ResourceInput
                    key={k}
                    label={t[k]}
                    value={state.consManual[k]}
                    mul={state.consManualMul[k]}
                    aiClass={aiCls(`t4.${k}`)}
                    units={MUL_UNITS}
                    t={t}
                    onValue={(v) => {
                      unmarkAi(`t4.${k}`);
                      setState((s) => ({ ...s, consManual: { ...s.consManual, [k]: normalizeDigits(v) } }));
                    }}
                    onMul={(v) => {
                      unmarkAi(`t4.${k}`);
                      setState((s) => ({ ...s, consManualMul: { ...s.consManualMul, [k]: v } }));
                    }}
                  />
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["iron", "silver", "crystal"] as const).map((k) => (
                  <ResourceInput
                    key={k}
                    label={t[k]}
                    value={state.consManual[k]}
                    mul={state.consManualMul[k]}
                    aiClass={aiCls(`t4.${k}`)}
                    units={MUL_UNITS}
                    t={t}
                    onValue={(v) => {
                      unmarkAi(`t4.${k}`);
                      setState((s) => ({ ...s, consManual: { ...s.consManual, [k]: normalizeDigits(v) } }));
                    }}
                    onMul={(v) => {
                      unmarkAi(`t4.${k}`);
                      setState((s) => ({ ...s, consManualMul: { ...s.consManualMul, [k]: v } }));
                    }}
                  />
                ))}
              </div>
              <div className="px-2 pb-1 text-center text-[9px] text-muted-foreground">
                {t.perSoldiersFor} <span dir="ltr" className="tabular-nums">{consSoldierEff > 0 ? formatBigUnit(consSoldierEff, lang) : "—"}</span> {t.soldier}
              </div>
            </div>

            {isConsumptionReady && (
              <div className="rounded-xl border border-brand/30 bg-[color-mix(in_oklab,var(--brand)_8%,transparent)] p-2">
                <div className="mb-1 text-center text-[10px] font-bold text-muted-foreground">
                  {t.autoFromTable2}: <span className="tabular-nums" dir="ltr">{formatNumber(Math.round(effectiveSoldiers))}</span>
                </div>
                <div className="grid grid-cols-5 gap-0.5 text-center">
                  {RES_ORDER.map((k) => (
                    <div key={k} className="rounded-md bg-background/40 px-0.5 py-1">
                      <div className="text-[8px] font-bold text-muted-foreground">{t[k]}</div>
                      <div className="text-[10px] font-extrabold tabular-nums" dir="ltr">{formatBigUnit(consTotal[k], lang)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Grand summary */}
            <div className="rounded-xl border border-amber-400/40 bg-gradient-to-br from-amber-50 to-orange-50 p-3 dark:from-amber-950/40 dark:to-orange-950/30">
              <div className="mb-2 text-center text-[11px] font-extrabold text-amber-900 dark:text-amber-200">{t.summaryTitle}</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2 py-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground">{t.sumHours}</span>
                  <span className="text-[12px] font-extrabold text-brand tabular-nums" dir="ltr">{formatHours(totalHours)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2 py-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground">{t.sumSoldiers}</span>
                  <span className="text-[12px] font-extrabold text-brand tabular-nums" dir="ltr">{formatBigUnit(effectiveSoldiers, lang)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-background/60 px-2 py-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground">{t.sumPower}</span>
                  <span className="text-[12px] font-extrabold text-brand tabular-nums" dir="ltr">{formatBigUnit(totalPower, lang)}</span>
                </div>
                <div className="rounded-lg bg-background/60 px-2 py-1.5">
                  <div className="mb-1 text-center text-[10px] font-bold text-muted-foreground">{t.sumResources}</div>
                  <div className="grid grid-cols-5 gap-1 text-center">
                    {RES_ORDER.map((k) => (
                      <div key={k}>
                        <div className="text-[8px] font-bold text-muted-foreground">{t[k]}</div>
                        <div className="text-[10px] font-extrabold tabular-nums" dir="ltr">{isConsumptionReady ? formatBigUnit(consTotal[k], lang) : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* TABLE 5 — Boxes */}
        {activeTab === 4 && (() => {
          const visibleBoxes = BOXES.filter((b) => !b.woodOnly || state.resource === "wood");
          const totalRes = visibleBoxes.reduce((acc, b) => acc + parseNum(state.boxes[b.key]) * b.value, 0);
          const iron = totalRes / 6;
          const silver = totalRes / 24;
          const resName = state.resource === "wood" ? t.wood : t.wheat;
          const fmtUnit = (n: number, divisor: number, unitLabel: string, name: string) => {
            const v = n / divisor;
            return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unitLabel} ${name}`;
          };
          return (
            <section className="card-grad overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <h2 className="text-sm font-extrabold">{t.table5Title}</h2>
                <select
                  className="num-input compact !w-auto"
                  value={state.resource}
                  onChange={(e) => setState((s) => ({ ...s, resource: e.target.value as "wood" | "wheat" }))}
                >
                  <option value="wood">{t.wood}</option>
                  <option value="wheat">{t.wheat}</option>
                </select>
              </div>

              <div className="px-2 py-2">
                <div
                  className="grid items-stretch gap-1.5 text-center text-[11px] font-bold text-muted-foreground"
                  style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}
                >
                  <div className="py-1">{t.boxType}</div>
                  <div className="py-1">{t.boxCount}</div>
                </div>

                <div className="mt-1 space-y-1.5">
                  {visibleBoxes.map((b) => {
                    const label = `${t[b.labelKey]} ${resName}`;
                    return (
                      <div
                        key={b.key}
                        className="grid items-center gap-1.5 rounded-xl bg-[color-mix(in_oklab,var(--surface-2)_70%,transparent)] px-2 py-1.5"
                        style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}
                      >
                        <div className="min-w-0 truncate text-center text-[12px] font-bold">{label}</div>
                        <input
                          inputMode="decimal"
                          className="num-input compact"
                          value={state.boxes[b.key]}
                          placeholder="0"
                          onChange={(e) =>
                            setState((s) => ({ ...s, boxes: { ...s.boxes, [b.key]: normalizeDigits(e.target.value) } }))
                          }
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 space-y-1.5">
                  <ReadonlyResult label={`${t.totalResource} ${resName}`} value={fmtUnit(totalRes, 1e9, t.unitBillion, resName)} tone="brand" />
                  <ReadonlyResult label={t.iron} value={fmtUnit(iron, 1e6, t.unitMillion, t.iron)} tone="success" />
                  <ReadonlyResult label={t.silver} value={fmtUnit(silver, 1e6, t.unitMillion, t.silver)} />
                </div>
              </div>
            </section>
          );
        })()}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
          <div className="rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}

function ImageUpload({
  label, busy, busyLabel, onFile,
}: { label: string; busy: boolean; busyLabel: string; onFile: (f: File) => void }) {
  return (
    <div className="border-b border-border bg-[color-mix(in_oklab,var(--surface-2)_50%,transparent)] px-3 py-2 text-center">
      <label className={`btn ${busy ? "btn-ghost" : "btn-secondary"} inline-flex cursor-pointer items-center gap-2 text-[11px]`}>
        {busy ? busyLabel : `📷 ${label}`}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function ResourceInput({
  label,
  value,
  mul,
  aiClass,
  units,
  t,
  onValue,
  onMul,
}: {
  label: string;
  value: string;
  mul: string;
  aiClass: string;
  units: typeof MUL_UNITS;
  t: { [K in (typeof MUL_UNITS)[number]["k"]]: string };
  onValue: (value: string) => void;
  onMul: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-center text-[10px] font-bold text-muted-foreground">{label}</div>
      <input
        inputMode="decimal"
        className={`num-input compact w-full !text-[12px] ${aiClass}`}
        value={value}
        placeholder="0"
        onChange={(e) => onValue(e.target.value)}
      />
      <select
        className="num-input compact mt-1 w-full !px-0.5 !text-[9px]"
        value={mul}
        onChange={(e) => onMul(e.target.value)}
      >
        {units.map((u) => (
          <option key={u.v} value={u.v}>{t[u.k]}</option>
        ))}
      </select>
    </div>
  );
}

function ReadonlyResult({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "brand" | "success" | "neutral";
}) {
  const bg = tone === "brand"
    ? "color-mix(in oklab, var(--brand) 18%, transparent)"
    : tone === "success"
      ? "color-mix(in oklab, var(--success) 18%, transparent)"
      : "color-mix(in oklab, var(--surface-2) 90%, transparent)";
  const color = tone === "brand" ? "var(--brand)" : tone === "success" ? "var(--success)" : undefined;
  return (
    <div className="rounded-xl px-3 py-2.5 text-center" style={{ background: bg }}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <input
        readOnly
        className="num-input compact mt-1 cursor-default !text-[14px] font-extrabold"
        style={{ color }}
        value={value}
        dir="ltr"
      />
    </div>
  );
}

function OcrImageReview({
  src, show, onToggle, height, onHeightChange, zoom, onZoomChange, labels,
}: {
  src: string | null;
  show: boolean;
  onToggle: () => void;
  height: number;
  onHeightChange: (h: number) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  labels: { show: string; hide: string };
}) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: height };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = e.clientY - dragRef.current.startY;
    const maxH = typeof window !== "undefined" ? window.innerHeight * 0.5 : 400;
    const next = Math.max(80, Math.min(maxH, dragRef.current.startH + dy));
    onHeightChange(next);
  };
  const onPointerUp = () => { dragRef.current = null; };

  if (!src) return null;

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <button onClick={onToggle} className="btn btn-ghost !py-0.5 text-[10px]">
          {show ? labels.hide : labels.show}
        </button>
        {show && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onZoomChange(Math.max(0.5, +(zoom - 0.25).toFixed(2)))}
              className="btn btn-ghost !px-2 !py-0.5 text-[12px]"
              aria-label="zoom-out"
            >−</button>
            <span className="min-w-[34px] text-center text-[10px] tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => onZoomChange(Math.min(4, +(zoom + 0.25).toFixed(2)))}
              className="btn btn-ghost !px-2 !py-0.5 text-[12px]"
              aria-label="zoom-in"
            >＋</button>
          </div>
        )}
      </div>
      {show && (
        <>
          <div className="overflow-auto" style={{ height, maxHeight: "50vh" }}>
            <img
              src={src}
              alt=""
              style={{ width: `${zoom * 100}%`, maxWidth: "none", display: "block" }}
            />
          </div>
          <div
            className="flex h-3 cursor-row-resize items-center justify-center bg-[color-mix(in_oklab,var(--brand)_30%,transparent)] touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div className="h-1 w-12 rounded-full bg-foreground/40" />
          </div>
        </>
      )}
    </div>
  );
}

function TasarihSplit({
  src, height, onHeightChange, onClose, removeLabel,
}: { src: string; height: number; onHeightChange: (h: number) => void; onClose: () => void; removeLabel: string }) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: height };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = e.clientY - dragRef.current.startY;
    const next = Math.max(80, Math.min(window.innerHeight * 0.7, dragRef.current.startH + dy));
    onHeightChange(next);
  };
  const onPointerUp = () => { dragRef.current = null; };
  return (
    <div className="sticky top-0 z-40 w-full border-b border-border bg-background shadow-sm">
      <div className="relative w-full overflow-auto" style={{ height }}>
        <img src={src} alt="" className="block w-full" />
        <button onClick={onClose} className="absolute right-2 top-2 rounded-full bg-foreground/80 px-3 py-1 text-[10px] font-bold text-background">
          ✕ {removeLabel}
        </button>
      </div>
      <div
        className="flex h-3 cursor-row-resize items-center justify-center bg-[color-mix(in_oklab,var(--brand)_30%,transparent)] touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-1 w-12 rounded-full bg-foreground/40" />
      </div>
    </div>
  );
}
