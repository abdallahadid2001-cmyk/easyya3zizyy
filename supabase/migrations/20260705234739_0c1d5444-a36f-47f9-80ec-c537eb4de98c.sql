
-- Anonymous users (client-generated UUID stored in localStorage)
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY,
  first_seen_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  last_seen_date  date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date
);
CREATE INDEX app_users_last_seen_idx ON public.app_users(last_seen_date);

-- Daily aggregates: one row per day, atomic increments only
CREATE TABLE public.daily_stats (
  day          date PRIMARY KEY,
  new_users    int    NOT NULL DEFAULT 0,
  dau          int    NOT NULL DEFAULT 0,
  ocr_total    int    NOT NULL DEFAULT 0,
  ocr_success  int    NOT NULL DEFAULT 0,
  ocr_fail     int    NOT NULL DEFAULT 0,
  ocr_ms_sum   bigint NOT NULL DEFAULT 0,
  ocr_ms_count int    NOT NULL DEFAULT 0
);

-- Grants: only service_role can touch tables. Anon/authenticated cannot SELECT/INSERT directly.
GRANT ALL ON public.app_users   TO service_role;
GRANT ALL ON public.daily_stats TO service_role;

-- RLS enabled with no policies => no access via Data API for anon/authenticated.
ALTER TABLE public.app_users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_stats ENABLE ROW LEVEL SECURITY;

-- Single entry point: one round-trip per event, one write to app_users (only if day changed) + one upsert to daily_stats.
CREATE OR REPLACE FUNCTION public.record_activity(
  p_client_id   uuid,
  p_event       text,             -- 'open' | 'ocr_success' | 'ocr_fail'
  p_duration_ms int DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'utc')::date;
  v_prev        date;
  v_new         boolean := false;
  v_first_today boolean := false;
BEGIN
  IF p_client_id IS NULL OR p_event NOT IN ('open','ocr_success','ocr_fail') THEN
    RETURN;
  END IF;

  -- Clamp duration to sane bounds to prevent poisoned averages.
  IF p_duration_ms IS NOT NULL AND (p_duration_ms < 0 OR p_duration_ms > 600000) THEN
    p_duration_ms := NULL;
  END IF;

  SELECT last_seen_date INTO v_prev FROM public.app_users WHERE id = p_client_id;

  IF v_prev IS NULL THEN
    INSERT INTO public.app_users(id, first_seen_date, last_seen_date)
    VALUES (p_client_id, v_today, v_today)
    ON CONFLICT (id) DO NOTHING;
    v_new := true;
    v_first_today := true;
  ELSIF v_prev < v_today THEN
    UPDATE public.app_users SET last_seen_date = v_today
    WHERE id = p_client_id AND last_seen_date < v_today;
    v_first_today := FOUND;
  END IF;

  INSERT INTO public.daily_stats(
    day, new_users, dau, ocr_total, ocr_success, ocr_fail, ocr_ms_sum, ocr_ms_count
  ) VALUES (
    v_today,
    CASE WHEN v_new THEN 1 ELSE 0 END,
    CASE WHEN v_first_today THEN 1 ELSE 0 END,
    CASE WHEN p_event LIKE 'ocr_%' THEN 1 ELSE 0 END,
    CASE WHEN p_event = 'ocr_success' THEN 1 ELSE 0 END,
    CASE WHEN p_event = 'ocr_fail'    THEN 1 ELSE 0 END,
    COALESCE(CASE WHEN p_event = 'ocr_success' THEN p_duration_ms END, 0),
    CASE WHEN p_event = 'ocr_success' AND p_duration_ms IS NOT NULL THEN 1 ELSE 0 END
  )
  ON CONFLICT (day) DO UPDATE SET
    new_users    = daily_stats.new_users    + EXCLUDED.new_users,
    dau          = daily_stats.dau          + EXCLUDED.dau,
    ocr_total    = daily_stats.ocr_total    + EXCLUDED.ocr_total,
    ocr_success  = daily_stats.ocr_success  + EXCLUDED.ocr_success,
    ocr_fail     = daily_stats.ocr_fail     + EXCLUDED.ocr_fail,
    ocr_ms_sum   = daily_stats.ocr_ms_sum   + EXCLUDED.ocr_ms_sum,
    ocr_ms_count = daily_stats.ocr_ms_count + EXCLUDED.ocr_ms_count;
END;
$$;

-- Only anon needs to call it (the app has no auth). Authenticated also allowed for admin use.
GRANT EXECUTE ON FUNCTION public.record_activity(uuid, text, int) TO anon, authenticated;

-- Read-only overview view for admins/dashboards. Uses aggregate reads over tiny tables.
CREATE OR REPLACE VIEW public.stats_overview
WITH (security_invoker = on) AS
SELECT
  (SELECT count(*) FROM public.app_users)                                        AS total_users,
  (SELECT count(*) FROM public.app_users WHERE last_seen_date = (now() AT TIME ZONE 'utc')::date)                          AS dau_today,
  (SELECT count(*) FROM public.app_users WHERE last_seen_date >= (now() AT TIME ZONE 'utc')::date - INTERVAL '30 days')   AS mau_30d,
  (SELECT COALESCE(sum(ocr_total),0)   FROM public.daily_stats)                  AS ocr_total_all_time,
  (SELECT COALESCE(sum(ocr_success),0) FROM public.daily_stats)                  AS ocr_success_all_time,
  (SELECT COALESCE(sum(ocr_fail),0)    FROM public.daily_stats)                  AS ocr_fail_all_time,
  (SELECT CASE WHEN sum(ocr_ms_count) > 0
               THEN (sum(ocr_ms_sum)::numeric / sum(ocr_ms_count))::int
               ELSE 0 END
     FROM public.daily_stats)                                                    AS avg_ocr_ms_all_time;
