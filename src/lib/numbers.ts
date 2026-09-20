// Convert Arabic-Indic digits to ASCII, strip non-digits/dots, parse as float.
const arabicDigits: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export function normalizeDigits(input: string): string {
  let s = "";
  for (const ch of input) s += arabicDigits[ch] ?? ch;
  // keep digits and a single dot
  s = s.replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  return s;
}

export function parseNum(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const s = typeof input === "number" ? String(input) : normalizeDigits(input);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatHours(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // up to 2 decimals, trim trailing zeros
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatBigUnit(n: number, lang: "ar" | "en"): string {
  const abs = Math.abs(n);
  const units =
    lang === "ar"
      ? [
          { v: 1e9, s: " مليار" },
          { v: 1e6, s: " مليون" },
          { v: 1e3, s: " ألف" },
        ]
      : [
          { v: 1e9, s: "B" },
          { v: 1e6, s: "M" },
          { v: 1e3, s: "K" },
        ];
  for (const u of units) {
    if (abs >= u.v) {
      return (n / u.v).toLocaleString("en-US", { maximumFractionDigits: 2 }) + u.s;
    }
  }
  return formatNumber(Math.round(n));
}
