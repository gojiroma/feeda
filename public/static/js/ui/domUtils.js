// DOM Utilities - 共通DOM操作機能
// DOMの作成、操作、スタイル設定を共通化

// Keys createElement gives special handling below — everything else in
// `options` is a plain DOM property (href, target, rel, src, alt, loading,
// type, value, placeholder, required, ariaLabel, ...) and gets assigned
// directly onto the element. Without this fallback, any caller passing one
// of those (e.g. an `<a href target="_blank">` real link, an `<input
// type placeholder>`) would have it silently dropped — every browser
// reflects these as element properties with matching (or camelCased) names,
// so a direct assignment is all they need.
const CREATE_ELEMENT_SPECIAL_KEYS = new Set(["className", "textContent", "html", "dataset", "style", "id", "title", "children"]);

/**
 * 要素を作成
 * @param {string} tagName - タグ名
 * @param {Object} options - オプション
 * @param {string} options.className - クラス名
 * @param {string} options.textContent - テキストコンテンツ
 * @param {string} options.html - HTMLコンテンツ
 * @param {Object} options.dataset - data-* 属性
 * @param {Object} options.style - スタイルオブジェクト
 * @param {string} options.id - ID
 * @param {string} options.title - タイトル
 * @param {Array} options.children - 子要素配列
 * @param {*} options.* - その他はDOMプロパティとしてそのまま設定（href, target, src など）
 * @returns {HTMLElement} - 作成された要素
 */
export function createElement(tagName, options = {}) {
  const {
    className = "",
    textContent = "",
    html = "",
    dataset = {},
    style = {},
    id = "",
    title = "",
    children = []
  } = options;
  const el = document.createElement(tagName);

  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  if (html) el.innerHTML = html;
  if (id) el.id = id;
  if (title) el.title = title;

  Object.entries(dataset).forEach(([key, value]) => {
    el.dataset[key] = value;
  });

  Object.entries(style).forEach(([key, value]) => {
    if (key.startsWith("--")) {
      el.style.setProperty(key, value);
    } else {
      el.style[key] = value;
    }
  });

  children.forEach(child => {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  });

  for (const [key, value] of Object.entries(options)) {
    if (CREATE_ELEMENT_SPECIAL_KEYS.has(key) || value === undefined) continue;
    el[key] = value;
  }

  return el;
}

/**
 * ボタンを作成
 * @param {Object} options - createElementと同じオプション
 * @param {Function} onClick - クリック時のコールバック
 * @returns {HTMLButtonElement} - 作成されたボタン
 */
export function createButton(options = {}, onClick) {
  const btn = createElement("button", {
    type: "button",
    ...options
  });
  
  if (onClick) {
    btn.addEventListener("click", onClick);
  }
  
  return btn;
}

/**
 * リンクを作成
 * @param {Object} options - createElementと同じオプション
 * @param {string} href - href属性
 * @param {Function} onClick - クリック時のコールバック
 * @returns {HTMLAnchorElement} - 作成されたリンク
 */
export function createLink(options = {}, href = "#", onClick) {
  const link = createElement("a", {
    href,
    ...options
  });
  
  if (onClick) {
    link.addEventListener("click", onClick);
  }
  
  return link;
}

/**
 * 入力フィールドを作成
 * @param {Object} options - createElementと同じオプション
 * @param {string} type - 入力タイプ（デフォルト: "text"）
 * @param {string} value - 初期値
 * @param {string} placeholder - プレースホルダ
 * @param {boolean} required - 必須か
 * @param {Function} onInput - 入力時のコールバック
 * @param {Function} onChange - 変更時のコールバック
 * @returns {HTMLInputElement} - 作成された入力フィールド
 */
export function createInput(options = {}, {
  type = "text",
  value = "",
  placeholder = "",
  required = false,
  onInput,
  onChange
} = {}) {
  const input = createElement("input", {
    type,
    value,
    placeholder,
    required,
    ...options
  });
  
  if (onInput) {
    input.addEventListener("input", onInput);
  }
  
  if (onChange) {
    input.addEventListener("change", onChange);
  }
  
  return input;
}

/**
 * 要素にクラスをトグル
 * @param {HTMLElement} el - 要素
 * @param {string} className - クラス名
 * @param {boolean} force - 強制的に設定
 */
export function toggleClass(el, className, force) {
  if (force !== undefined) {
    el.classList[force ? 'add' : 'remove'](className);
  } else {
    el.classList.toggle(className);
  }
}

/**
 * 要素を表示/非表示
 * @param {HTMLElement} el - 要素
 * @param {boolean} show - 表示するか
 * @param {string} hiddenClass - 非表示クラス（デフォルト: "hidden"）
 */
export function setVisible(el, show, hiddenClass = "hidden") {
  toggleClass(el, hiddenClass, !show);
}

/**
 * 要素の表示状態をトグル
 * @param {HTMLElement} el - 要素
 * @param {string} hiddenClass - 非表示クラス（デフォルト: "hidden"）
 */
export function toggleVisible(el, hiddenClass = "hidden") {
  setVisible(el, !el.classList.contains(hiddenClass), hiddenClass);
}

/**
 * 子要素をすべて削除
 * @param {HTMLElement} el - 要素
 */
export function clearChildren(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * 要素を空にする
 * @param {HTMLElement} el - 要素
 */
export function emptyElement(el) {
  el.innerHTML = "";
}

/**
 * 要素のスタイルを設定
 * @param {HTMLElement} el - 要素
 * @param {Object} styles - スタイルオブジェクト
 */
export function setStyle(el, styles) {
  Object.entries(styles).forEach(([key, value]) => {
    if (key.startsWith("--")) {
      el.style.setProperty(key, value);
    } else {
      el.style[key] = value;
    }
  });
}

/**
 * 要素のカスタムプロパティを設定
 * @param {HTMLElement} el - 要素
 * @param {string} name - プロパティ名（--を付けない）
 * @param {string} value - 値
 */
export function setCustomProperty(el, name, value) {
  el.style.setProperty(`--${name}`, value);
}

/**
 * 要素の属性を設定
 * @param {HTMLElement} el - 要素
 * @param {string} name - 属性名
 * @param {string} value - 値
 */
export function setAttribute(el, name, value) {
  if (value !== undefined && value !== null) {
    el.setAttribute(name, value);
  } else {
    el.removeAttribute(name);
  }
}

/**
 * 要素のデータ属性を設定
 * @param {HTMLElement} el - 要素
 * @param {string} name - 属性名（data-を付けない）
 * @param {string} value - 値
 */
export function setDataAttribute(el, name, value) {
  setAttribute(el, `data-${name}`, value);
}

/**
 * 要素のaria属性を設定
 * @param {HTMLElement} el - 要素
 * @param {string} name - 属性名（aria-を付けない）
 * @param {string} value - 値
 */
export function setAriaAttribute(el, name, value) {
  setAttribute(el, `aria-${name}`, value);
}

/**
 * 要素を挿入（指定位置）
 * @param {HTMLElement} parent - 親要素
 * @param {HTMLElement} child - 子要素
 * @param {HTMLElement|string} reference - 基準要素または位置（"beforebegin", "afterbegin", "beforeend", "afterend"）
 */
export function insertElement(parent, child, reference = "beforeend") {
  if (typeof reference === 'string') {
    parent.insertAdjacentElement(reference, child);
  } else if (reference) {
    parent.insertBefore(child, reference);
  } else {
    parent.appendChild(child);
  }
}

/**
 * 要素を置き換え
 * @param {HTMLElement} oldEl - 古い要素
 * @param {HTMLElement} newEl - 新しい要素
 */
export function replaceElement(oldEl, newEl) {
  oldEl.parentNode.replaceChild(newEl, oldEl);
}

/**
 * 要素をクローン
 * @param {HTMLElement} el - 要素
 * @param {boolean} deep - 深いクローンか（デフォルト: true）
 * @returns {HTMLElement} - クローンされた要素
 */
export function cloneElement(el, deep = true) {
  return el.cloneNode(deep);
}

/**
 * 要素のサイズを取得
 * @param {HTMLElement} el - 要素
 * @returns {Object} - { width, height, x, y, top, right, bottom, left }
 */
export function getElementSize(el) {
  return el.getBoundingClientRect();
}

/**
 * 要素がビューポート内にあるかチェック
 * @param {HTMLElement} el - 要素
 * @returns {boolean} - ビューポート内にあるか
 */
export function isInViewport(el) {
  const rect = getElementSize(el);
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * 要素をビューポート内にクランプ
 * @param {HTMLElement} el - 要素
 * @param {number} margin - マージン（デフォルト: 8）
 */
export function clampToViewport(el, margin = 8) {
  const rect = getElementSize(el);
  const maxLeft = window.innerWidth - rect.width - margin;
  const maxTop = window.innerHeight - rect.height - margin;
  
  const left = Math.max(margin, Math.min(parseInt(el.style.left) || 0, maxLeft));
  const top = Math.max(margin, Math.min(parseInt(el.style.top) || 0, maxTop));
  
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
