import { renderQrCode, startQrScanner } from "../qr.js";
import { createPairingCode, pollPairingStatus, consumePairingCode, invalidatePairingCode } from "../pairing.js";

const POLL_INTERVAL_MS = 2500;

// PAIR_TTL_SECONDS is hours-long now (see config.py), not a few minutes —
// includes the hour digit whenever there's at least one, so this reads as
// "残り 2:59:42" instead of an unbroken minute count like "179:42".
function formatRemaining(expiresAtIso) {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const time = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return `残り ${time}`;
}

// Wires the two "share this device's seed" flows (QR + 6-digit code), both
// opened from the seed modal once a session already exists.
export function setupPairingShareUI({ getSeed, getApiBase }) {
  const qrBtn = document.getElementById("seed-qr-share-btn");
  const codeBtn = document.getElementById("seed-code-share-btn");

  const qrModal = document.getElementById("qr-share-modal");
  const qrBox = document.getElementById("qr-share-box");
  const qrCloseBtn = document.getElementById("qr-share-close-btn");

  const codeModal = document.getElementById("code-share-modal");
  const codeValueEl = document.getElementById("code-share-value");
  const codeStatusEl = document.getElementById("code-share-status");
  const codeCloseBtn = document.getElementById("code-share-close-btn");

  function closeQr() {
    qrModal.classList.add("hidden");
  }

  qrBtn.addEventListener("click", async () => {
    qrBox.textContent = "生成中…";
    qrModal.classList.remove("hidden");
    try {
      const payload = JSON.stringify({ seed: getSeed(), apiBase: getApiBase() });
      await renderQrCode(qrBox, payload);
    } catch (err) {
      console.error("[feeda] QR generation failed", err);
      qrBox.textContent = "QRコードの生成に失敗しました。";
    }
  });
  qrCloseBtn.addEventListener("click", closeQr);
  qrModal.addEventListener("click", (ev) => {
    if (ev.target === qrModal) closeQr();
  });

  let pollTimer = null;
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function closeCode() {
    codeModal.classList.add("hidden");
    stopPolling();
  }

  // The code just shown, if any — so generating a new one can invalidate it
  // first (see below). PAIR_TTL_SECONDS is now hours-long rather than a few
  // minutes, so without this a re-share (e.g. the first code went to the
  // wrong device, or was just misread) would leave the old code sitting
  // around valid for hours instead of expiring with the modal.
  let lastGeneratedCode = null;

  codeBtn.addEventListener("click", async () => {
    codeValueEl.textContent = "------";
    codeStatusEl.textContent = "コードを発行しています…";
    codeModal.classList.remove("hidden");
    stopPolling();
    const apiBase = getApiBase();
    if (lastGeneratedCode) {
      invalidatePairingCode(apiBase, lastGeneratedCode).catch((err) =>
        console.error("[feeda] previous pairing code invalidation failed", err)
      );
      lastGeneratedCode = null;
    }
    try {
      const payload = { seed: getSeed(), apiBase };
      const { code, expiresAt } = await createPairingCode(apiBase, payload);
      lastGeneratedCode = code;
      codeValueEl.textContent = code;

      pollTimer = setInterval(async () => {
        const remaining = formatRemaining(expiresAt);
        if (remaining === null) {
          codeStatusEl.textContent = "コードの有効期限が切れました。もう一度発行してください。";
          stopPolling();
          return;
        }
        try {
          const status = await pollPairingStatus(apiBase, code);
          if (status.found && status.consumed) {
            codeStatusEl.textContent = "✓ 別の端末で受け取られました。";
            stopPolling();
            return;
          }
        } catch {
          // transient poll failure — just try again next tick
        }
        codeStatusEl.textContent = `別の端末で入力してください。（${remaining}）`;
      }, POLL_INTERVAL_MS);
      codeStatusEl.textContent = `別の端末で入力してください。（${formatRemaining(expiresAt)}）`;
    } catch (err) {
      console.error("[feeda] pairing code creation failed", err);
      codeStatusEl.textContent = `コードの発行に失敗しました: ${err.message}`;
    }
  });
  codeCloseBtn.addEventListener("click", closeCode);
  codeModal.addEventListener("click", (ev) => {
    if (ev.target === codeModal) closeCode();
  });
}

// Wires the two "receive a seed from another device" flows (QR scan + 6-
// digit code entry), both opened from the setup screen before a session
// exists yet. `onReceived(seed, apiBase)` fills the setup form for review
// rather than starting the session directly, so the normal "start" button
// and its validation stay the single entry point into initSession.
// `getApiBase` reads whatever's currently in the setup form's API base
// field, since that's the only hint available yet about where this
// device's /api/pair endpoint lives.
export function setupPairingReceiveUI({ onReceived, getApiBase }) {
  const qrScanBtn = document.getElementById("setup-qr-scan-btn");
  const codeReceiveBtn = document.getElementById("setup-code-receive-btn");

  const qrModal = document.getElementById("qr-scan-modal");
  const qrVideo = document.getElementById("qr-scan-video");
  const qrStatus = document.getElementById("qr-scan-status");
  const qrCancelBtn = document.getElementById("qr-scan-cancel-btn");

  let stopScanner = null;
  function closeQrScan() {
    qrModal.classList.add("hidden");
    if (stopScanner) {
      stopScanner();
      stopScanner = null;
    }
  }

  function handleDecoded(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!data || typeof data.seed !== "string") {
      qrStatus.textContent = "feedaのQRコードではないようです。もう一度お試しください。";
      return;
    }
    closeQrScan();
    onReceived(data.seed, data.apiBase || "");
  }

  qrScanBtn.addEventListener("click", async () => {
    qrStatus.textContent = "";
    qrModal.classList.remove("hidden");
    try {
      stopScanner = await startQrScanner(qrVideo, handleDecoded);
    } catch (err) {
      console.error("[feeda] camera start failed", err);
      qrStatus.textContent = "カメラを起動できませんでした。権限を確認してください。";
    }
  });
  qrCancelBtn.addEventListener("click", closeQrScan);
  qrModal.addEventListener("click", (ev) => {
    if (ev.target === qrModal) closeQrScan();
  });

  const codeModal = document.getElementById("code-receive-modal");
  const codeInput = document.getElementById("code-receive-input");
  const codeStatus = document.getElementById("code-receive-status");
  const codeSubmitBtn = document.getElementById("code-receive-submit-btn");
  const codeCancelBtn = document.getElementById("code-receive-cancel-btn");

  function closeCodeReceive() {
    codeModal.classList.add("hidden");
    codeInput.value = "";
    codeStatus.textContent = "";
  }

  codeReceiveBtn.addEventListener("click", () => {
    codeModal.classList.remove("hidden");
    codeInput.focus();
  });
  codeCancelBtn.addEventListener("click", closeCodeReceive);
  codeModal.addEventListener("click", (ev) => {
    if (ev.target === codeModal) closeCodeReceive();
  });

  codeSubmitBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    codeStatus.textContent = "受け取っています…";
    try {
      const data = await consumePairingCode(getApiBase(), code);
      if (!data || typeof data.seed !== "string") throw new Error("データの形式が不正です。");
      closeCodeReceive();
      onReceived(data.seed, data.apiBase || "");
    } catch (err) {
      codeStatus.textContent = err.message;
    }
  });
}
