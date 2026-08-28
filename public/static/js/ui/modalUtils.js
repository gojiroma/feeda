// Modal Utilities - 共通モーダル機能
// モーダルの表示/非表示、イベントハンドリングを共通化

/**
 * モーダルの基本機能をセットアップ
 * @param {HTMLElement} triggerBtn - モーダルを開くトリガーボタン
 * @param {HTMLElement} modalEl - モーダル要素
 * @param {Object} options - オプション
 * @param {Function} options.onOpen - モーダルを開いた時のコールバック
 * @param {Function} options.onClose - モーダルを閉じた時のコールバック
 * @param {boolean} options.closeOnBackgroundClick - 背景クリックで閉じるか（デフォルト: true）
 * @param {boolean} options.closeOnEscape - Escapeキーで閉じるか（デフォルト: true）
 * @returns {Object} - { open, close } メソッド
 */
export function setupModal(triggerBtn, modalEl, {
  onOpen,
  onClose,
  closeOnBackgroundClick = true,
  closeOnEscape = true,
} = {}) {
  function open() {
    modalEl.classList.remove("hidden");
    onOpen?.();
  }

  function close() {
    modalEl.classList.add("hidden");
    onClose?.();
  }

  // トリガーボタンクリック
  triggerBtn?.addEventListener("click", open);

  // 背景クリックで閉じる
  if (closeOnBackgroundClick) {
    modalEl.addEventListener("click", (ev) => {
      if (ev.target === modalEl) close();
    });
  }

  // Escapeキーで閉じる
  if (closeOnEscape) {
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !modalEl.classList.contains("hidden")) {
        close();
      }
    });
  }

  return { open, close };
}

/**
 * 閉じるボタンを持つモーダルのセットアップ
 * @param {HTMLElement} triggerBtn - モーダルを開くトリガーボタン
 * @param {HTMLElement} modalEl - モーダル要素
 * @param {string} closeBtnId - 閉じるボタンのID
 * @param {Object} options - setupModalと同じオプション
 * @returns {Object} - { open, close } メソッド
 */
export function setupModalWithCloseBtn(triggerBtn, modalEl, closeBtnId, options = {}) {
  const closeBtn = document.getElementById(closeBtnId);
  
  const modal = setupModal(triggerBtn, modalEl, options);

  // 閉じるボタンクリック
  closeBtn?.addEventListener("click", modal.close);

  return modal;
}

/**
 * フォームを持つモーダルのセットアップ
 * @param {HTMLElement} triggerBtn - モーダルを開くトリガーボタン
 * @param {HTMLElement} modalEl - モーダル要素
 * @param {string} formId - フォームのID
 * @param {Object} options - setupModalと同じオプション
 * @param {Function} options.onSubmit - フォーム送信時のコールバック
 * @returns {Object} - { open, close } メソッド
 */
export function setupFormModal(triggerBtn, modalEl, formId, {
  onSubmit,
  ...modalOptions
} = {}) {
  const formEl = document.getElementById(formId);
  
  const modal = setupModal(triggerBtn, modalEl, modalOptions);

  // フォーム送信
  formEl?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    onSubmit?.(ev);
  });

  return modal;
}

/**
 * コピーボタンを持つモーダルのセットアップ
 * @param {HTMLElement} triggerBtn - モーダルを開くトリガーボタン
 * @param {HTMLElement} modalEl - モーダル要素
 * @param {string} copyBtnId - コピーボタンのID
 * @param {Function} getCopyText - コピーするテキストを返す関数
 * @param {Object} options - setupModalと同じオプション
 * @returns {Object} - { open, close } メソッド
 */
export function setupCopyModal(triggerBtn, modalEl, copyBtnId, getCopyText, options = {}) {
  const copyBtn = document.getElementById(copyBtnId);
  
  const modal = setupModal(triggerBtn, modalEl, options);

  // コピーボタンクリック
  copyBtn?.addEventListener("click", async () => {
    try {
      const text = getCopyText?.();
      if (text) {
        await navigator.clipboard.writeText(text);
        const original = copyBtn.textContent;
        copyBtn.textContent = "コピーしました";
        setTimeout(() => { 
          copyBtn.textContent = original; 
        }, 1200);
      }
    } catch (err) {
      console.error("clipboard copy failed", err);
    }
  });

  return modal;
}
