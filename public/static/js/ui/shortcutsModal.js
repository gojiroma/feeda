// Static reference card for wireKeyboardNav's shortcuts (see main.js) — the
// content itself lives in index.html's #shortcuts-modal since it never
// changes at runtime, unlike ng-word/seed's modals. Returns { open } so
// main.js's own keydown handler can trigger it from "?" without this file
// needing its own second global keydown listener for that one key.
export function setupShortcutsModal(triggerBtn, modalEl) {
  const closeBtn = document.getElementById("shortcuts-modal-close-btn");

  function open() {
    modalEl.classList.remove("hidden");
  }

  function close() {
    modalEl.classList.add("hidden");
  }

  triggerBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modalEl.addEventListener("click", (ev) => {
    if (ev.target === modalEl) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !modalEl.classList.contains("hidden")) close();
  });

  return { open };
}
