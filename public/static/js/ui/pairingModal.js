import { renderQrCode, startQrScanner } from "../qr.js";
import { createPairingCode, pollPairingStatus, consumePairingCode, invalidatePairingCode } from "../pairing.js";
import { setupModalWithCloseBtn } from "./modalUtils.js";
import { renderEmptyHint } from "./listUtils.js";

const POLL_INTERVAL_MS = 2500;

// PAIR_TTL_SECONDS is hours-long now (see config.py), not a few minutes \u2014
// includes the hour digit whenever there's at least one, so this reads as
// "\u6b8b\u308i 2:59:42" instead of an unbroken minute count like "179:42".
function formatRemaining(expiresAtIso) {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const time = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return `\u6b8b\u308i ${time}`;
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

  function openQr() {
    qrBox.textContent = "\u751f\u6210\u4e2d\u2026";
    qrModal.classList.remove("hidden");
    generateQrCode();
  }

  async function generateQrCode() {
    try {
      const payload = JSON.stringify({ seed: getSeed(), apiBase: getApiBase() });
      await renderQrCode(qrBox, payload);
    } catch (err) {
      console.error("[feeda] QR generation failed", err);
      qrBox.textContent = "QR\u30b3\u30fc\u30c9\u306e\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002";
    }
  }

  // 共通モーダルセットアップ
  setupModalWithCloseBtn(qrBtn, qrModal, "qr-share-close-btn", {
    onOpen: openQr,
    onClose: closeQr,
    closeOnBackgroundClick: true,
    closeOnEscape: true
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

  function openCode() {
    codeValueEl.textContent = "------";
    codeStatusEl.textContent = "\u30b3\u30fc\u30c9\u3092\u767a\u884c\u3057\u3066\u3044\u307e\u3059\u2026";
    codeModal.classList.remove("hidden");
    startPolling();
  }

  // The code just shown, if any \u2014 so generating a new one can invalidate it
  // first (see below). PAIR_TTL_SECONDS is now hours-long rather than a few
  // minutes, so without this a re-share (e.g. the first code went to the
  // wrong device, or was just misread) would leave the old code sitting
  // around valid for hours instead of expiring with the modal.
  let lastGeneratedCode = null;

  async function startPolling() {
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
          codeStatusEl.textContent = "\u30b3\u30fc\u30c9\u306e\u6709\u52b9\u671f\u9650\u304c\u5207\u308c\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u767a\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
          stopPolling();
          return;
        }
        try {
          const status = await pollPairingStatus(apiBase, code);
          if (status.found && status.consumed) {
            codeStatusEl.textContent = "\u2713 \u5225\u306e\u7aef\u672b\u3067\u53d7\u3051\u53d6\u3089\u308c\u307e\u3057\u305f\u3002";
            stopPolling();
            return;
          }
        } catch {
          // transient poll failure \u2014 just try again next tick
        }
        codeStatusEl.textContent = `\u5225\u306e\u7aef\u672b\u3067\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u0028${remaining}\u0029`;
      }, POLL_INTERVAL_MS);
      codeStatusEl.textContent = `\u5225\u306e\u7aef\u672b\u3067\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u0028${formatRemaining(expiresAt)}\u0029`;
    } catch (err) {
      console.error("[feeda] pairing code creation failed", err);
      codeStatusEl.textContent = `\u30b3\u30fc\u30c9\u306e\u767a\u884c\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${err.message}`;
    }
  }

  // 共通モーダルセットアップ
  setupModalWithCloseBtn(codeBtn, codeModal, "code-share-close-btn", {
    onOpen: openCode,
    onClose: closeCode,
    closeOnBackgroundClick: true,
    closeOnEscape: true
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

  function openQrScan() {
    qrStatus.textContent = "";
    qrModal.classList.remove("hidden");
    startScanner();
  }

  async function startScanner() {
    try {
      stopScanner = await startQrScanner(qrVideo, handleDecoded);
    } catch (err) {
      console.error("[feeda] camera start failed", err);
      qrStatus.textContent = "\u30ab\u30e1\u30e9\u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u6a29\u9650\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
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
      qrStatus.textContent = "feeda\u306eQR\u30b3\u30fc\u30c9\u3067\u306f\u306a\u3044\u3088\u3046\u3067\u3059\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002";
      return;
    }
    closeQrScan();
    onReceived(data.seed, data.apiBase || "");
  }

  // 共通モーダルセットアップ
  setupModalWithCloseBtn(qrScanBtn, qrModal, "qr-scan-cancel-btn", {
    onOpen: openQrScan,
    onClose: closeQrScan,
    closeOnBackgroundClick: true,
    closeOnEscape: true
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

  function openCodeReceive() {
    codeModal.classList.remove("hidden");
    codeInput.focus();
  }

  // 共通モーダルセットアップ
  setupModalWithCloseBtn(codeReceiveBtn, codeModal, "code-receive-cancel-btn", {
    onOpen: openCodeReceive,
    onClose: closeCodeReceive,
    closeOnBackgroundClick: true,
    closeOnEscape: true
  });

  codeSubmitBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    codeStatus.textContent = "\u53d7\u3051\u53d6\u3083\u3066\u3044\u307e\u3059\u2026";
    try {
      const data = await consumePairingCode(getApiBase(), code);
      if (!data || typeof data.seed !== "string") throw new Error("\u30c7\u30fc\u30bf\u306e\u5f62\u5f0f\u304c\u4e0d\u6b63\u3067\u3059\u3002");
      closeCodeReceive();
      onReceived(data.seed, data.apiBase || "");
    } catch (err) {
      codeStatus.textContent = err.message;
    }
  });
}
