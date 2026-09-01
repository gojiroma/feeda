import { getSession } from "./session.js";

// 1日あたりの閲覧上限（秒）。表示専用 — 実際の判定は毎回サーバー側の値
// （backend/config.py の DAILY_VIEW_LIMIT_SECONDS）に従う。
export const DAILY_LIMIT_SECONDS = 8 * 60;

// Foreground time is reported in small increments rather than one big
// number at the end, so the server-side total stays accurate even if the
// tab is closed, crashes, or loses connectivity mid-session.
const HEARTBEAT_INTERVAL_MS = 20 * 1000;
const HEARTBEAT_SECONDS = HEARTBEAT_INTERVAL_MS / 1000;
// While locked there's nothing left to accumulate — this only needs to be
// frequent enough to notice the local calendar day rolling over promptly.
const LOCK_POLL_INTERVAL_MS = 60 * 1000;
// Drives the on-screen countdown (see onTick in startViewTimeTracking)
// between heartbeats, so the displayed number visibly ticks down once a
// second instead of jumping only every HEARTBEAT_INTERVAL_MS.
const COUNTDOWN_TICK_MS = 1000;

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function authHeaders() {
  const { accountId } = getSession();
  return { Authorization: `Bearer ${accountId}` };
}

// Local calendar day, not UTC — matches logbook.js's dateStrOf so "today's"
// budget resets at local midnight, the moment the user actually experiences
// a new day.
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchStatus() {
  const res = await fetch(`${apiUrl("/api/view-time/status")}?viewDate=${todayStr()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`view-time status failed: ${res.status}`);
  return res.json();
}

// Exposed separately from startViewTimeTracking so main.js's startApp can
// await it and decide the *initial* screen (振り返る vs 見る) — and seed the
// countdown watermark's starting point — before the first render, instead
// of always booting into 見る with a blank timer and only correcting both a
// moment later once the first status check resolves. Fails open (not
// locked, full budget shown) on a network error — a status-check hiccup
// shouldn't lock someone out of reading or show a bogus countdown.
export async function fetchInitialStatus() {
  try {
    return await fetchStatus();
  } catch (err) {
    console.error("view-time status check failed", err);
    return { limitReached: false, secondsViewed: 0, limitSeconds: DAILY_LIMIT_SECONDS };
  }
}

async function sendHeartbeat() {
  const res = await fetch(apiUrl("/api/view-time/heartbeat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ viewDate: todayStr(), seconds: HEARTBEAT_SECONDS }),
  });
  if (!res.ok) throw new Error(`view-time heartbeat failed: ${res.status}`);
  return res.json();
}

// Server-side per-account daily view-time budget (see
// backend/routes/view_time.py) — kept in the DB rather than only in
// localStorage so clearing site data, or opening the same account on
// another device, doesn't reset the clock. This module only tracks state
// and reports transitions via onLocked/onUnlocked (main.js owns what a lock
// actually does — forcing and pinning 振り返る, see applyViewTimeLock) and
// the remaining seconds via onTick (main.js's countdown watermark, see
// updateViewTimeWatermark). initialStatus is the result of an earlier
// fetchInitialStatus() call, so this doesn't repeat that same status fetch
// a second time on startup.
export function startViewTimeTracking({ initialStatus, onLocked, onUnlocked, onTick }) {
  let heartbeatTimer = null;
  let lockPollTimer = null;
  let countdownTimer = null;
  let secondsViewed = initialStatus.secondsViewed;
  let limitSeconds = initialStatus.limitSeconds;

  function remainingSeconds() {
    return Math.max(0, limitSeconds - secondsViewed);
  }

  function reportTick() {
    onTick?.(remainingSeconds());
  }

  function applyStatus(status) {
    secondsViewed = status.secondsViewed;
    limitSeconds = status.limitSeconds;
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function stopLockPoll() {
    clearInterval(lockPollTimer);
    lockPollTimer = null;
  }

  function stopCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  // Only counts down while the tab actually has the foreground (backgrounded,
  // minimized, another tab focused) — same condition as tick() below, since
  // the server-side budget itself only grows from foreground heartbeats.
  // Each heartbeat's response (see tick()) overwrites this local count with
  // the server's own figure, so up to ~HEARTBEAT_INTERVAL_MS of local drift
  // (a throttled background timer, another tab also accumulating today's
  // budget, ...) self-corrects every 20s rather than compounding.
  function tickCountdown() {
    if (document.hidden) return;
    secondsViewed = Math.min(limitSeconds, secondsViewed + 1);
    reportTick();
  }

  function startForeground() {
    reportTick();
    heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    countdownTimer = setInterval(tickCountdown, COUNTDOWN_TICK_MS);
  }

  function lock() {
    stopHeartbeat();
    stopCountdown();
    secondsViewed = limitSeconds;
    reportTick();
    onLocked();
    lockPollTimer = setInterval(() => {
      fetchStatus()
        .then((status) => (status.limitReached ? applyStatus(status) : unlock(status)))
        .catch((err) => console.error("view-time status check failed", err));
    }, LOCK_POLL_INTERVAL_MS);
  }

  function unlock(status) {
    stopLockPoll();
    if (status) applyStatus(status);
    onUnlocked();
    startForeground();
  }

  function tick() {
    if (document.hidden) return;
    sendHeartbeat()
      .then((status) => {
        applyStatus(status);
        reportTick();
        if (status.limitReached) lock();
      })
      .catch((err) => console.error("view-time heartbeat failed", err));
  }

  if (initialStatus.limitReached) {
    lock();
  } else {
    startForeground();
  }
}
