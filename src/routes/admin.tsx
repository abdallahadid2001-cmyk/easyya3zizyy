import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAdminStats, type AdminStats } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  ssr: false,
  component: AdminPage,
});

function AdminPage() {
  const fetchStats = useServerFn(getAdminStats);
  const [password, setPassword] = useState("");
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (pwd: string, d: number) => {
      setLoading(true);
      setError(null);
      try {
        const s = await fetchStats({ data: { password: pwd, days: d } });
        setStats(s);
        setAuthed(true);
      } catch {
        setError("كلمة المرور غير صحيحة");
        setAuthed(false);
        setStats(null);
      } finally {
        setLoading(false);
      }
    },
    [fetchStats],
  );

  const chartData = useMemo(
    () =>
      (stats?.daily ?? []).map((r) => ({
        day: r.day.slice(5),
        total: r.ocr_total,
        success: r.ocr_success,
        fail: r.ocr_fail,
        dau: r.dau,
      })),
    [stats],
  );

  if (!authed) {
    return (
      <div dir="rtl" className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>لوحة التحكم</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                load(password, days);
              }}
              className="space-y-3"
            >
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="كلمة المرور"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || !password}>
                {loading ? "جاري التحقق..." : "دخول"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">لوحة التحكم</h1>
          <div className="flex flex-wrap gap-2">
            {[7, 30, 90].map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? "default" : "outline"}
                onClick={() => {
                  setDays(d as 7 | 30 | 90);
                  load(password, d);
                }}
              >
                {d} يوم
              </Button>
            ))}
            <Button size="sm" onClick={() => load(password, days)} disabled={loading}>
              {loading ? "..." : "تحديث"}
            </Button>
          </div>
        </div>

        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="زيارات اليوم" value={stats.visitsToday} />
              <StatCard label="نشطون اليوم" value={stats.dauToday} />
              <StatCard label="زيارات الفترة" value={stats.visitsMonth} />
              <StatCard label="نشطون (30 يوم)" value={stats.mau} />
              <StatCard label="إجمالي المستخدمين" value={stats.totalUsers} />
              <StatCard label="إجمالي التحليلات" value={stats.ocrTotal} />
              <StatCard label="ناجحة" value={stats.ocrSuccess} />
              <StatCard label="فاشلة" value={stats.ocrFail} />
              <StatCard label="نسبة النجاح" value={`${stats.successRate.toFixed(1)}%`} />
              <StatCard label="متوسط الزمن" value={`${(stats.avgMs / 1000).toFixed(2)}s`} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">تحليلات يومية ({days} يوم)</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="success" stackId="a" fill="hsl(var(--primary))" />
                    <Bar dataKey="fail" stackId="a" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">المستخدمون النشطون يوميًا</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Line type="monotone" dataKey="dau" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">أكثر الأيام استخدامًا</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {stats.topDays.map((d) => (
                    <li key={d.day} className="flex justify-between py-2 text-sm">
                      <span>{d.day}</span>
                      <span className="font-medium">{d.ocr_total}</span>
                    </li>
                  ))}
                  {stats.topDays.length === 0 && (
                    <li className="py-2 text-sm text-muted-foreground">لا توجد بيانات</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
