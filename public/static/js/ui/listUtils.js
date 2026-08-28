// List Utilities - 共通リスト表示機能
// リストのレンダリング、フィルタリング、空状態表示を共通化

/**
 * 空状態のヒントを表示
 * @param {HTMLElement} container - コンテナ要素
 * @param {string} hintText - ヒントテキスト
 * @param {string} className - クラス名（デフォルト: "empty-hint"）
 */
export function renderEmptyHint(container, hintText, className = "empty-hint") {
  container.innerHTML = "";
  const hint = document.createElement("p");
  hint.className = className;
  hint.textContent = hintText;
  container.appendChild(hint);
}

/**
 * 基本的なリストアイテムを作成
 * @param {string} tagName - タグ名（デフォルト: "li"）
 * @param {string} className - クラス名
 * @param {string} textContent - テキストコンテンツ
 * @param {Object} dataset - data-* 属性
 * @returns {HTMLElement} - 作成された要素
 */
export function createListItem(tagName = "li", className = "", textContent = "", dataset = {}) {
  const item = document.createElement(tagName);
  if (className) item.className = className;
  if (textContent) item.textContent = textContent;
  Object.entries(dataset).forEach(([key, value]) => {
    item.dataset[key] = value;
  });
  return item;
}

/**
 * 削除ボタン付きのリストアイテムを作成
 * @param {string} textContent - テキストコンテンツ
 * @param {Function} onRemove - 削除時のコールバック
 * @param {string} itemClass - アイテムクラス（デフォルト: ""）
 * @param {string} btnClass - ボタンクラス（デフォルト: ""）
 * @param {string} btnText - ボタンテキスト（デフォルト: "×"）
 * @param {string} btnTitle - ボタンタイトル（デフォルト: "削除"）
 * @returns {HTMLElement} - 作成された要素
 */
export function createRemovableListItem(textContent, onRemove, {
  itemClass = "",
  btnClass = "",
  btnText = "×",
  btnTitle = "削除"
} = {}) {
  const li = document.createElement("li");
  li.className = itemClass;
  
  const span = document.createElement("span");
  span.textContent = textContent;
  li.appendChild(span);
  
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = btnClass;
  removeBtn.textContent = btnText;
  removeBtn.title = btnTitle;
  removeBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onRemove?.();
  });
  li.appendChild(removeBtn);
  
  return li;
}

/**
 * 単純なリストをレンダリング
 * @param {HTMLElement} container - コンテナ要素
 * @param {Array} items - アイテム配列
 * @param {Object} options - オプション
 * @param {Function} options.renderItem - アイテムレンダリング関数
 * @param {string} options.emptyHint - 空状態のヒント（デフォルト: "項目がありません"）
 * @param {string} options.listClass - リストクラス（デフォルト: ""）
 * @param {string} options.itemClass - アイテムクラス（デフォルト: ""）
 */
export function renderSimpleList(container, items, {
  renderItem,
  emptyHint = "項目がありません",
  listClass = "",
  itemClass = ""
} = {}) {
  container.innerHTML = "";
  
  if (items.length === 0) {
    renderEmptyHint(container, emptyHint);
    return;
  }
  
  const ul = document.createElement("ul");
  if (listClass) ul.className = listClass;
  
  for (const item of items) {
    const li = renderItem ? renderItem(item) : createListItem("li", itemClass, item);
    ul.appendChild(li);
  }
  
  container.appendChild(ul);
}

/**
 * タグチップを作成
 * @param {string} tag - タグテキスト
 * @param {Function} onRemove - 削除時のコールバック
 * @param {boolean} isDisplayOnly - 表示専用か（デフォルト: false）
 * @returns {HTMLElement} - 作成された要素
 */
export function createTagChip(tag, onRemove, isDisplayOnly = false) {
  const chip = document.createElement("span");
  chip.className = isDisplayOnly ? "tag-chip tag-chip--display" : "tag-chip";
  
  const label = document.createElement("span");
  label.textContent = tag;
  chip.appendChild(label);
  
  if (!isDisplayOnly && onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "タグを削除";
    removeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onRemove(tag);
    });
    chip.appendChild(removeBtn);
  }
  
  return chip;
}

/**
 * タグチップの行を作成
 * @param {Array} tags - タグ配列
 * @param {Function} onRemove - 削除時のコールバック
 * @param {boolean} isDisplayOnly - 表示専用か（デフォルト: false）
 * @param {string} className - クラス名（デフォルト: "tag-chip-row"）
 * @returns {HTMLElement} - 作成された要素
 */
export function createTagChipRow(tags, onRemove, isDisplayOnly = false, className = "tag-chip-row") {
  const row = document.createElement("div");
  row.className = className;
  
  for (const tag of tags) {
    row.appendChild(createTagChip(tag, onRemove, isDisplayOnly));
  }
  
  return row;
}

/**
 * タグエディタをレンダリング（タグチップ行 + 追加フォーム）
 * @param {HTMLElement} container - コンテナ要素
 * @param {Object} options - オプション
 * @param {Array} options.tags - タグ配列
 * @param {Function} options.onAddTag - タグ追加時のコールバック
 * @param {Function} options.onRemoveTag - タグ削除時のコールバック
 * @param {string} options.tagChipRowClass - タグチップ行クラス（デフォルト: "tag-chip-row"）
 * @param {string} options.formClass - フォームクラス（デフォルト: "tag-add-form"）
 * @param {string} options.inputClass - 入力フィールドクラス（デフォルト: "tag-add-input"）
 * @param {string} options.inputPlaceholder - 入力フィールドプレースホルダ（デフォルト: "タグを追加…"）
 */
export function renderTagEditor(container, {
  tags = [],
  onAddTag,
  onRemoveTag,
  tagChipRowClass = "tag-chip-row",
  formClass = "tag-add-form",
  inputClass = "tag-add-input",
  inputPlaceholder = "タグを追加…"
} = {}) {
  // 既存のタグチップ行
  if (tags.length > 0) {
    container.appendChild(createTagChipRow(tags, onRemoveTag, false, tagChipRowClass));
  }
  
  // タグ追加フォーム
  if (onAddTag) {
    const form = document.createElement("form");
    form.className = formClass;
    
    const input = document.createElement("input");
    input.type = "text";
    input.className = inputClass;
    input.placeholder = inputPlaceholder;
    form.appendChild(input);
    
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const text = input.value.trim();
      if (text) {
        input.value = "";
        onAddTag(text);
      }
    });
    
    container.appendChild(form);
  }
}

/**
 * フィルタリングされたリストをレンダリング
 * @param {HTMLElement} container - コンテナ要素
 * @param {Array} items - 全てのアイテム
 * @param {Function} filterFn - フィルタ関数
 * @param {Object} options - renderSimpleListと同じオプション
 */
export function renderFilteredList(container, items, filterFn, options = {}) {
  const filteredItems = filterFn ? items.filter(filterFn) : items;
  renderSimpleList(container, filteredItems, options);
}

/**
 * ソートされたリストをレンダリング
 * @param {HTMLElement} container - コンテナ要素
 * @param {Array} items - 全てのアイテム
 * @param {Function} sortFn - ソート関数
 * @param {Object} options - renderSimpleListと同じオプション
 */
export function renderSortedList(container, items, sortFn, options = {}) {
  const sortedItems = [...items];
  if (sortFn) {
    sortedItems.sort(sortFn);
  }
  renderSimpleList(container, sortedItems, options);
}
