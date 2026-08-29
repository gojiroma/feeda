// Common Components - 共通UIコンポーネント
// 色スウォッチ・色フィルタの共通UIを提供

import { COLOR_PALETTE } from "../colorPalette.js";
import { createButton } from "./domUtils.js";

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
