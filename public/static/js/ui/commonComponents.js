// Common Components - 共通UIコンポーネント
// 色スウォッチ、タグエディタ、フィルタなどの共通UIを提供

import { COLOR_PALETTE, COLOR_BY_KEY } from "../colorPalette.js";
import { createElement, createButton } from "./domUtils.js";

/**
 * 色スウォッチを作成
 * @param {string} colorKey - 色キー
 * @param {string} rgb - RGB値
 * @param {boolean} isSelected - 選択状態
 * @param {Function} onClick - クリック時のコールバック
 * @returns {HTMLButtonElement} - 作成されたスウォッチボタン
 */
export function createColorSwatch(colorKey, rgb, isSelected, onClick) {
  return createButton(
    {
      type: "button",
      className: `feed-color-swatch${isSelected ? " selected" : ""}`,
      style: { "--feed-color": rgb },
      title: `色${colorKey}`
    },
    onClick
  );
}

/**
 * 色スウォッチ行をレンダリング
 * @param {HTMLElement} container - コンテナ要素
 * @param {Object} options - オプション
 * @param {string} options.currentColor - 現在の色
 * @param {Function} options.onSetColor - 色設定時のコールバック
 * @param {boolean} options.showClear - クリアボタンを表示するか（デフォルト: true）
 */
export function renderColorSwatches(container, {
  currentColor,
  onSetColor,
  showClear = true
} = {}) {
  container.innerHTML = "";
  
  for (const { key, rgb } of COLOR_PALETTE) {
    container.appendChild(
      createColorSwatch(key, rgb, currentColor === key, () => onSetColor?.(key))
    );
  }

  if (showClear) {
    const clearBtn = createButton(
      {
        type: "button",
        className: `feed-color-swatch feed-color-swatch--clear${!currentColor ? " selected" : ""}`,
        title: "色をクリア",
        textContent: "×"
      },
      () => onSetColor?.(null)
    );
    container.appendChild(clearBtn);
  }
}

/**
 * タグチップを作成
 * @param {string} tag - タグテキスト
 * @param {Function} onRemove - 削除時のコールバック
 * @param {boolean} isDisplayOnly - 表示専用か
 * @returns {HTMLElement} - 作成されたタグチップ
 */
export function createTagChip(tag, onRemove, isDisplayOnly = false) {
  const chip = createElement("span", {
    className: isDisplayOnly ? "tag-chip tag-chip--display" : "tag-chip"
  });
  
  const label = createElement("span", { textContent: tag });
  chip.appendChild(label);
  
  if (!isDisplayOnly && onRemove) {
    const removeBtn = createButton(
      {
        type: "button",
        textContent: "×",
        title: "タグを削除"
      },
      (ev) => {
        ev.stopPropagation();
        onRemove(tag);
      }
    );
    chip.appendChild(removeBtn);
  }
  
  return chip;
}

/**
 * タグチップ行を作成
 * @param {Array} tags - タグ配列
 * @param {Function} onRemove - 削除時のコールバック
 * @param {boolean} isDisplayOnly - 表示専用か
 * @param {string} className - クラス名
 * @returns {HTMLElement} - 作成された要素
 */
export function createTagChipRow(tags, onRemove, isDisplayOnly = false, className = "tag-chip-row") {
  const row = createElement("div", { className });
  
  for (const tag of tags) {
    row.appendChild(createTagChip(tag, onRemove, isDisplayOnly));
  }
  
  return row;
}

/**
 * タグエディタをレンダリング
 * @param {HTMLElement} container - コンテナ要素
 * @param {Object} options - オプション
 * @param {Array} options.tags - タグ配列
 * @param {Function} options.onAddTag - タグ追加時のコールバック
 * @param {Function} options.onRemoveTag - タグ削除時のコールバック
 * @param {string} options.tagChipRowClass - タグチップ行クラス
 * @param {string} options.formClass - フォームクラス
 * @param {string} options.inputClass - 入力フィールドクラス
 * @param {string} options.inputPlaceholder - 入力フィールドプレースホルダ
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
    const form = createElement("form", { className: formClass });
    
    const input = createElement("input", {
      type: "text",
      className: inputClass,
      placeholder: inputPlaceholder
    });
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
 * フィルタースウォッチを作成
 * @param {string} colorKey - 色キー
 * @param {string} rgb - RGB値
 * @param {boolean} isActive - アクティブ状態
 * @param {Function} onToggle - トグル時のコールバック
 * @returns {HTMLButtonElement} - 作成されたフィルタースウォッチ
 */
export function createFilterSwatch(colorKey, rgb, isActive, onToggle) {
  return createButton(
    {
      type: "button",
      className: `feed-color-filter-swatch${isActive ? " selected" : ""}`,
      style: { "--feed-color": rgb },
      title: isActive ? "この色のフィルタを解除" : "この色のフィルタを適用",
      dataset: { color: colorKey }
    },
    () => onToggle?.(colorKey)
  );
}

/**
 * 色フィルタをレンダリング
 * @param {HTMLElement} container - コンテナ要素
 * @param {Object} options - オプション
 * @param {Array} options.feeds - フィード配列
 * @param {Set} options.activeColors - アクティブな色のSet
 * @param {Function} options.onToggleColor - 色トグル時のコールバック
 */
export function renderColorFilter(container, {
  feeds,
  activeColors,
  onToggleColor
} = {}) {
  container.innerHTML = "";
  const usedColors = new Set(feeds.map((f) => f.color).filter(Boolean));
  
  if (usedColors.size === 0) return;

  for (const { key, rgb } of COLOR_PALETTE) {
    if (!usedColors.has(key)) continue;
    container.appendChild(
      createFilterSwatch(key, rgb, activeColors.has(key), onToggleColor)
    );
  }

  if (activeColors.size > 0) {
    const clearBtn = createButton(
      {
        type: "button",
        className: "feed-color-filter-clear",
        textContent: "×",
        title: "色フィルタをすべて解除"
      },
      () => onToggleColor?.(null)
    );
    container.appendChild(clearBtn);
  }
}

/**
 * 状態バッジを作成
 * @param {string} text - テキスト
 * @param {string} type - タイプ（"unread", "paused", "pinned" など）
 * @param {string} title - タイトル
 * @returns {HTMLElement} - 作成されたバッジ
 */
export function createStatusBadge(text, type = "", title = "") {
  return createElement("span", {
    className: `status-badge${type ? ` status-badge--${type}` : ""}`,
    textContent: text,
    title
  });
}

/**
 * アイコンボタンを作成
 * @param {Object} options - createButtonと同じオプション
 * @param {string} icon - アイコン（テキストまたはemoji）
 * @param {Function} onClick - クリック時のコールバック
 * @returns {HTMLButtonElement} - 作成されたボタン
 */
export function createIconButton(options = {}, icon, onClick) {
  return createButton(
    {
      className: "icon-btn",
      ...options,
      html: icon
    },
    onClick
  );
}

/**
 * 検索履歴チップを作成
 * @param {string} query - クエリ
 * @param {string} color - ハイライト色
 * @param {Function} onClick - クリック時のコールバック
 * @returns {HTMLButtonElement} - 作成されたチップ
 */
export function createSearchHistoryChip(query, color, onClick) {
  return createButton(
    {
      type: "button",
      className: "search-history-chip",
      style: { "--search-highlight-color": color },
      textContent: query
    },
    onClick
  );
}

/**
 * 空状態のヒントを表示
 * @param {HTMLElement} container - コンテナ要素
 * @param {string} hintText - ヒントテキスト
 * @param {string} className - クラス名
 */
export function renderEmptyHint(container, hintText, className = "empty-hint") {
  container.innerHTML = "";
  const hint = createElement("p", {
    className,
    textContent: hintText
  });
  container.appendChild(hint);
}
