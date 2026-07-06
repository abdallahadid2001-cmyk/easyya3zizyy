import { createServerFn } from "@tanstack/react-start";
import { createHash, timingSafeEqual } from "node:crypto";

function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export type DailyRow = {
  day: string;
  new_users: number;
  dau: number;
  ocr_total: number;
  ocr_success: number;
  ocr_fail: number;
  ocr_ms_sum: number;
  ocr_ms_count: number;
};

export type AdminStats = {
  totalUsers: number;
  visitsToday: number;
  visitsMonth: number;
  dauToday: number;
  mau: number;
  ocrTotal: number;
  ocrSuccess: number;
  ocrFail: number;
  successRate: number;
  avgMs: number;
  daily: DailyRow[]; // last N days ascending
  topDays: { day: string; ocr_total: number }[];
};

export const getAdminStats = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string; days?: number }) => ({
    password: String(data?.password ?? ""),
    days: Math.min(Math.max(Number(data?.days ?? 30) | 0, 1), 365),
  }))
  .handler(async ({ data }): Promise<AdminStats> => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) throw new Error("ADMIN_PASSWORD not configured");
    if (
      data.password.length === 0 ||
      data.password.length > 200 ||
      !passwordMatches(data.password, expected)
    ) {
      throw new Error("Unauthorized");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const todayStr = iso(today);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - (data.days - 1));
    const mauStart = new Date(today);
    mauStart.setDate(mauStart.getDate() - 29);

    // Pull enough daily_stats rows to compute everything in one query
    const earliest = rangeStart < monthStart ? rangeStart : monthStart;
    const { data: rows, error } = await supabaseAdmin
      .from("daily_stats")
      .select("*")
      .gte("day", iso(earliest))
      .order("day", { ascending: true });
    if (error) throw error;

    const all = (rows ?? []) as DailyRow[];
    const inRange = all.filter((r) => r.day >= iso(rangeStart));
    const inMonth = all.filter((r) => r.day >= iso(monthStart));
    const todayRow = all.find((r) => r.day === todayStr);

    // Totals: one lightweight count query
    const { count: totalUsers } = await supabaseAdmin
      .from("app_users")
      .select("id", { count: "exact", head: true });

    const { count: mau } = await supabaseAdmin
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .gte("last_seen_date", iso(mauStart));

    const sum = (arr: DailyRow[], k: keyof DailyRow) =>
      arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);

    const ocrTotal = sum(inRange, "ocr_total");
    const ocrSuccess = sum(inRange, "ocr_success");
    const ocrFail = sum(inRange, "ocr_fail");
    const msSum = sum(inRange, "ocr_ms_sum");
    const msCount = sum(inRange, "ocr_ms_count");

    const topDays = [...inRange]
      .sort((a, b) => b.ocr_total - a.ocr_total)
      .slice(0, 5)
      .map((r) => ({ day: r.day, ocr_total: r.ocr_total }));

    return {
      totalUsers: totalUsers ?? 0,
      visitsToday: todayRow?.dau ?? 0,
      visitsMonth: sum(inMonth, "dau"),
      dauToday: todayRow?.dau ?? 0,
      mau: mau ?? 0,
      ocrTotal,
      ocrSuccess,
      ocrFail,
      successRate: ocrTotal > 0 ? (ocrSuccess / ocrTotal) * 100 : 0,
      avgMs: msCount > 0 ? msSum / msCount : 0,
      daily: inRange,
      topDays,
    };
  });
