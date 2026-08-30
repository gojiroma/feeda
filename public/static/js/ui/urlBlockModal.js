import { addUrlBlockPattern, removeUrlBlockPattern, getActiveUrlBlockPatterns } from "../urlBlocks.js";
import { setupFormModal } from "./modalUtils.js";
import { createRemovableListItem, renderEmptyHint } from "./listUtils.js";

// "URLブロック" topbar button — review/add/remove "刈り取り" (reap) URL
// wildcard patterns (see urlBlocks.js). Most patterns get added from
// reflect.js's own 🚫 button instead of here, but a mistaken addition needs
// somewhere to review and undo, and this doubles as a way to add one by hand
// without going through a logged entry first. onChange fires after every
// add/remove so main.js can push the change to the server and re-apply the
// filter to whatever's currently on screen.
export function setupUrlBlockModal(triggerBtn, modalEl, { onChange } = {}) {
  const listEl = document.getElementById("url-block-list");
  const inputEl = document.getElementById("url-block-input");
  const closeBtn = document.getElementById("url-block-modal-close-btn");

  async function renderList() {
    const patterns = await getActiveUrlBlockPatterns();
    patterns.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    if (patterns.length === 0) {
      renderEmptyHint(listEl, "URLブロックパターンはまだ登録されていません。");
      return;
    }

    listEl.innerHTML = "";
    for (const entry of patterns) {
      const li = createRemovableListItem(
        entry.pattern,
        () => {
          removeUrlBlockPattern(entry.pattern)
            .then(() => renderList())
            .then(() => onChange?.())
            .catch((err) => console.error("url block remove failed", err));
        },
        {
          itemClass: "ng-word-item",
          btnTitle: "削除"
        }
      );
      listEl.appendChild(li);
    }
  }

  function close() {
    modalEl.classList.add("hidden");
  }

  setupFormModal(triggerBtn, modalEl, "url-block-form", {
    onSubmit: (ev) => {
      ev.preventDefault();
      const text = inputEl.value;
      if (!text.trim()) return;
      inputEl.value = "";
      addUrlBlockPattern(text)
        .then(() => renderList())
        .then(() => onChange?.())
        .catch((err) => console.error("url block add failed", err));
    },
    onOpen: () => renderList().catch((err) => console.error("url block list failed", err)),
    onClose: close,
    closeOnBackgroundClick: true,
    closeOnEscape: true
  });

  closeBtn.addEventListener("click", close);
}
