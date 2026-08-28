import { setupModalWithCloseBtn, setupCopyModal } from "./modalUtils.js";

// 共通モーダル機能を使用したシードモーダルのセットアップ
export function setupSeedModal(triggerBtn, modalEl, { getSeed, getApiBase }) {
  const seedInput = document.getElementById("seed-display");
  const apiBaseInput = document.getElementById("seed-modal-api-base");
  const copyBtn = document.getElementById("seed-copy-btn");
  const closeBtn = document.getElementById("seed-modal-close-btn");

  function open() {
    seedInput.value = getSeed();
    apiBaseInput.value = getApiBase() || "\u3008\u7a7a\u6b04 = \u540c\u4e00\u30c9\u30e1\u30a4\u30f3\u3009";
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
