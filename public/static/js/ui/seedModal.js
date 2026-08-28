import { setupModalWithCloseBtn, setupCopyModal } from "./modalUtils.js";

// 共通モーダル機能を使用したシードモーダルのセットアップ
export function setupSeedModal(triggerBtn, modalEl, { getSeed, getApiBase }) {
  const seedInput = document.getElementById("seed-display");
  const apiBaseInput = document.getElementById("seed-modal-api-base");
  const copyBtn = document.getElementById("seed-copy-btn");
  const closeBtn = document.getElementById("seed-modal-close-btn");

  function open() {
    seedInput.value = getSeed();
    apiBaseInput.value = getApiBase() || "〈空欄 = 同一ドメイン〉";
    modalEl.classList.remove("hidden");
  }

  function close() {
    modalEl.classList.add("hidden");
  }

  // 基本モーダルセットアップ
  setupModalWithCloseBtn(triggerBtn, modalEl, "seed-modal-close-btn", {
    onOpen: open,
    onClose: close,
    closeOnBackgroundClick: true,
    closeOnEscape: true
  });

  // コピーボタンのセットアップ
  setupCopyModal(null, modalEl, "seed-copy-btn", () => seedInput.value, {});
}
