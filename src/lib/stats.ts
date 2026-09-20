// Lightweight anonymous analytics — one RPC call per event, no PII, no logs.
import { supabase } from "@/integrations/supabase/client";

const CLIENT_ID_KEY = "stats.cid";
const SESSION_OPEN_KEY = "stats.openedThisSession";

function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      const uuid = globalThis.crypto?.randomUUID?.();
      id = typeof uuid === "string" ? uuid : fallbackUuid();
      window.localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function fallbackUuid(): string {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const n = Number(c);
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (n / 4);
    return (n ^ r).toString(16);
  });
}

type Event = "open" | "ocr_success" | "ocr_fail";

// Fire-and-forget. Never blocks the UI, never throws.
export function recordActivity(event: Event, durationMs?: number): void {
  const clientId = getClientId();
  if (!clientId) return;
  const p_duration_ms =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
      ? Math.round(durationMs)
      : undefined;
  supabase.rpc("record_activity", { p_client_id: clientId, p_event: event, p_duration_ms }).then(
    () => {},
    () => {},
  );
}

// Call once per browser session.
export function recordSessionOpen(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(SESSION_OPEN_KEY)) return;
    window.sessionStorage.setItem(SESSION_OPEN_KEY, "1");
  } catch {
    // Continue anyway — worst case one extra write per open.
  }
  recordActivity("open");
}
