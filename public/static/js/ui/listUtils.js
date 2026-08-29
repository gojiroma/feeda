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
