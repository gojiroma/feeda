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
// and reports transitions via onLocked/onUnlocked; main.js owns rendering
// the actual blocking overlay.
export function startViewTimeTracking({ onLocked, onUnlocked }) {
  let heartbeatTimer = null;
  let lockPollTimer = null;

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function stopLockPoll() {
    clearInterval(lockPollTimer);
    lockPollTimer = null;
  }

  function lock() {
    stopHeartbeat();
    onLocked();
    lockPollTimer = setInterval(() => {
      fetchStatus()
        .then(({ limitReached }) => {
          if (!limitReached) unlock();
        })
        .catch((err) => console.error("view-time status check failed", err));
    }, LOCK_POLL_INTERVAL_MS);
  }

  function unlock() {
    stopLockPoll();
    onUnlocked();
    heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  }

  // Only counts time the tab actually has in the foreground — a hidden tab
  // (backgrounded, minimized, another tab focused) sends nothing that
  // interval.
  function tick() {
    if (document.hidden) return;
    sendHeartbeat()
      .then(({ limitReached }) => {
        if (limitReached) lock();
      })
      .catch((err) => console.error("view-time heartbeat failed", err));
  }

  // Checked once up front (before this tab logs any time of its own) so an
  // already-exhausted budget — used up earlier today in another tab or on
  // another device sharing this account — locks immediately on load instead
  // of only after this tab's first heartbeat.
  fetchStatus()
    .then(({ limitReached }) => {
      if (limitReached) {
        lock();
      } else {
        heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
      }
    })
    .catch((err) => console.error("view-time status check failed", err));
}
