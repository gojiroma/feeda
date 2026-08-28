import { addNgWord, removeNgWord, getActiveNgWords } from "../ngWords.js";
import { setupFormModal } from "./modalUtils.js";
import { createRemovableListItem, renderEmptyHint } from "./listUtils.js";

// "NGワード" topbar button — add/remove blocklist keywords (see ngWords.js).
// onChange fires after every add/remove so main.js can push the change to
// the server and re-apply the filter to whatever's currently on screen.
export function setupNgWordModal(triggerBtn, modalEl, { onChange } = {}) {
  const listEl = document.getElementById("ng-word-list");
  const formEl = document.getElementById("ng-word-form");
  const inputEl = document.getElementById("ng-word-input");
  const closeBtn = document.getElementById("ng-word-modal-close-btn");

  async function renderList() {
    const words = await getActiveNgWords();
    words.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    
    if (words.length === 0) {
      renderEmptyHint(listEl, "NGワードはまだ登録されていません。");
      return;
    }
    
    listEl.innerHTML = "";
    for (const entry of words) {
      const li = createRemovableListItem(
        entry.word,
        () => {
          removeNgWord(entry.word)
            .then(() => renderList())
            .then(() => onChange?.())
            .catch((err) => console.error("ng word remove failed", err));
        },
        {
          itemClass: "ng-word-item",
          btnTitle: "削除"
        }
      );
      listEl.appendChild(li);
    }
  }

  function open() {
    modalEl.classList.remove("hidden");
    renderList().catch((err) => console.error("ng word list failed", err));
  }

  function close() {
    modalEl.classList.add("hidden");
  }

  // 共通モーダルセットアップ
  setupFormModal(triggerBtn, modalEl, "ng-word-form", {
    onSubmit: (ev) => {
      ev.preventDefault();
      const text = inputEl.value;
      if (!text.trim()) return;
      inputEl.value = "";
      addNgWord(text)
        .then(() => renderList())
        .then(() => onChange?.())
        .catch((err) => console.error("ng word add failed", err));
    },
    onClose: close,
    closeOnBackgroundClick: true,
    closeOnEscape: true
  });

  // 閉じるボタン
  closeBtn.addEventListener("click", close);
}
