// Static reference card for wireKeyboardNav's shortcuts (see main.js) — the
// content itself lives in index.html's #shortcuts-modal since it never
// changes at runtime, unlike ng-word/seed's modals. Returns { open } so
// main.js's own keydown handler can trigger it from "?" without this file
// needing its own second global keydown listener for that one key.
import { setupModalWithCloseBtn } from "./modalUtils.js";

export function setupShortcutsModal(triggerBtn, modalEl) {
  const closeBtn = document.getElementById("shortcuts-modal-close-btn");

  function open() {
    modalEl.classList.remove("hidden");
  }

  function close() {
    modalEl.classList.add("hidden");
  }

  // 共通モーダルセットアップ
  const modal = setupModalWithCloseBtn(triggerBtn, modalEl, "shortcuts-modal-close-btn", {
    onOpen: open,
    onClose: close,
    closeOnBackgroundClick: true,
    closeOnEscape: true
  });

  return modal;
}
