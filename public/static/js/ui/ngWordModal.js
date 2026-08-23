import { addNgWord, removeNgWord, getActiveNgWords } from "../ngWords.js";

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
    listEl.innerHTML = "";
    if (words.length === 0) {
      const hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "NGワードはまだ登録されていません。";
      listEl.appendChild(hint);
      return;
    }
    for (const entry of words) {
      const li = document.createElement("li");
      li.className = "ng-word-item";
      const span = document.createElement("span");
      span.textContent = entry.word;
      li.appendChild(span);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = "削除";
      removeBtn.addEventListener("click", () => {
        removeNgWord(entry.word)
          .then(() => renderList())
          .then(() => onChange?.())
          .catch((err) => console.error("ng word remove failed", err));
      });
      li.appendChild(removeBtn);
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

  triggerBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modalEl.addEventListener("click", (ev) => {
    if (ev.target === modalEl) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !modalEl.classList.contains("hidden")) close();
  });

  formEl.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = inputEl.value;
    if (!text.trim()) return;
    inputEl.value = "";
    addNgWord(text)
      .then(() => renderList())
      .then(() => onChange?.())
      .catch((err) => console.error("ng word add failed", err));
  });
}
