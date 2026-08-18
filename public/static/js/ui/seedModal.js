export function setupSeedModal(triggerBtn, modalEl, { getSeed, getApiBase }) {
  const seedInput = document.getElementById("seed-display");
  const apiBaseInput = document.getElementById("seed-modal-api-base");
  const copyBtn = document.getElementById("seed-copy-btn");
  const closeBtn = document.getElementById("seed-modal-close-btn");

  function open() {
    seedInput.value = getSeed();
    apiBaseInput.value = getApiBase() || "（空欄 = 同一ドメイン）";
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

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(seedInput.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = "コピーしました";
      setTimeout(() => { copyBtn.textContent = original; }, 1200);
    } catch (err) {
      console.error("clipboard copy failed", err);
    }
  });
}
