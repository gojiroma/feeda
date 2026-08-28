// Event Utilities - 共通イベントハンドリング機能
// イベントのデバウンス、スロットリング、ポインタイベントの共通化

/**
 * デバウンス関数
 * @param {Function} fn - 実行する関数
 * @param {number} wait - 待機時間（ミリ秒）
 * @param {boolean} immediate - すぐに実行するか（デフォルト: false）
 * @returns {Function} - デバウンスされた関数
 */
export function debounce(fn, wait = 150, immediate = false) {
  let timeout = null;
  
  return function(...args) {
    const context = this;
    const later = () => {
      timeout = null;
      if (!immediate) fn.apply(context, args);
    };
    
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    
    if (callNow) fn.apply(context, args);
  };
}

/**
 * スロットリング関数
 * @param {Function} fn - 実行する関数
 * @param {number} wait - 待機時間（ミリ秒）
 * @param {Object} options - オプション
 * @param {boolean} options.leading - 最初に実行するか（デフォルト: true）
 * @param {boolean} options.trailing - 最後に実行するか（デフォルト: true）
 * @returns {Function} - スロットリングされた関数
 */
export function throttle(fn, wait = 100, { leading = true, trailing = true } = {}) {
  let lastCall = 0;
  let timeout = null;
  let lastArgs = null;
  let lastContext = null;
  
  return function(...args) {
    const context = this;
    const now = Date.now();
    
    if (lastCall === 0 && !leading) {
      lastCall = now;
      return;
    }
    
    if (now - lastCall >= wait) {
      lastCall = now;
      fn.apply(context, args);
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    } else if (trailing) {
      lastArgs = args;
      lastContext = context;
      if (!timeout) {
        timeout = setTimeout(() => {
          lastCall = Date.now();
          timeout = null;
          fn.apply(lastContext, lastArgs);
          lastArgs = null;
          lastContext = null;
        }, wait - (now - lastCall));
      }
    }
  };
}

/**
 * 遅延実行関数
 * @param {Function} fn - 実行する関数
 * @param {number} delay - 遅延時間（ミリ秒）
 * @returns {Object} - { run, cancel } メソッド
 */
export function delayedExecute(fn, delay = 0) {
  let timeout = null;
  
  return {
    run: (...args) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    },
    cancel: () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }
  };
}

/**
 * 実行を1度だけ許可する関数
 * @param {Function} fn - 実行する関数
 * @returns {Function} - 1度だけ実行される関数
 */
export function once(fn) {
  let called = false;
  
  return function(...args) {
    if (called) return;
    called = true;
    fn.apply(this, args);
  };
}

/**
 * 条件付きで実行する関数
 * @param {Function} fn - 実行する関数
 * @param {Function} condition - 条件関数
 * @returns {Function} - 条件付き関数
 */
export function when(condition, fn) {
  return function(...args) {
    if (condition.apply(this, args)) {
      fn.apply(this, args);
    }
  };
}

/**
 * ポインタイベントの長押しを検出
 * @param {HTMLElement} el - 要素
 * @param {Function} onLongPress - 長押し時のコールバック
 * @param {Object} options - オプション
 * @param {number} options.duration - 長押し時間（ミリ秒、デフォルト: 550）
 * @param {Function} options.onStart - 押下時のコールバック
 * @param {Function} options.onCancel - キャンセル時のコールバック
 */
export function setupLongPress(el, onLongPress, {
  duration = 550,
  onStart,
  onCancel
} = {}) {
  let timer = null;
  let isPressed = false;
  
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    isPressed = false;
    onCancel?.();
  };
  
  const handlePointerDown = (ev) => {
    if (ev.pointerType !== 'touch' && ev.pointerType !== 'mouse') return;
    
    isPressed = true;
    onStart?.(ev);
    
    timer = setTimeout(() => {
      if (isPressed) {
        onLongPress?.(ev);
        isPressed = false;
      }
    }, duration);
  };
  
  const handlePointerUp = (ev) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    isPressed = false;
  };
  
  el.addEventListener('pointerdown', handlePointerDown);
  el.addEventListener('pointerup', handlePointerUp);
  el.addEventListener('pointercancel', handlePointerUp);
  el.addEventListener('pointermove', (ev) => {
    // 指が動いたら長押しをキャンセル
    if (isPressed && ev.pointerType === 'touch') {
      cancel();
    }
  });
  
  return { cancel };
}

/**
 * 要素外のクリックを検出
 * @param {HTMLElement} el - 要素
 * @param {Function} onOutsideClick - 要素外クリック時のコールバック
 * @param {Object} options - オプション
 * @param {boolean} options.capture - キャプチャフェーズ（デフォルト: true）
 */
export function setupOutsideClick(el, onOutsideClick, { capture = true } = {}) {
  const handler = (ev) => {
    if (!el.contains(ev.target)) {
      onOutsideClick?.(ev);
    }
  };
  
  document.addEventListener('pointerdown', handler, capture);
  
  return () => {
    document.removeEventListener('pointerdown', handler, capture);
  };
}

/**
 * Escapeキーの押下を検出
 * @param {Function} onEscape - Escapeキー押下時のコールバック
 * @param {Object} options - オプション
 * @param {boolean} options.capture - キャプチャフェーズ（デフォルト: false）
 * @returns {Function} - クリーンアップ関数
 */
export function setupEscapeKey(onEscape, { capture = false } = {}) {
  const handler = (ev) => {
    if (ev.key === 'Escape') {
      onEscape?.(ev);
    }
  };
  
  document.addEventListener('keydown', handler, capture);
  
  return () => {
    document.removeEventListener('keydown', handler, capture);
  };
}

/**
 * 要素のホバーを検出（タッチデバイス対応）
 * @param {HTMLElement} el - 要素
 * @param {Function} onHover - ホバー時のコールバック
 * @param {Function} onHoverEnd - ホバー終了時のコールバック
 * @returns {Object} - { enable, disable } メソッド
 */
export function setupHover(el, onHover, onHoverEnd) {
  let isHovered = false;
  let touchTimer = null;
  
  const handleMouseEnter = () => {
    isHovered = true;
    onHover?.();
  };
  
  const handleMouseLeave = () => {
    isHovered = false;
    onHoverEnd?.();
  };
  
  const handleTouchStart = () => {
    // タッチデバイスではタップをホバーとして扱う
    if (!isHovered) {
      isHovered = true;
      onHover?.();
    }
    // タッチが終わったらホバーを解除
    touchTimer = setTimeout(() => {
      isHovered = false;
      onHoverEnd?.();
    }, 300);
  };
  
  const handleTouchEnd = () => {
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
  };
  
  const enable = () => {
    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('touchstart', handleTouchStart);
    el.addEventListener('touchend', handleTouchEnd);
    el.addEventListener('touchcancel', handleTouchEnd);
  };
  
  const disable = () => {
    el.removeEventListener('mouseenter', handleMouseEnter);
    el.removeEventListener('mouseleave', handleMouseLeave);
    el.removeEventListener('touchstart', handleTouchStart);
    el.removeEventListener('touchend', handleTouchEnd);
    el.removeEventListener('touchcancel', handleTouchEnd);
    
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    
    if (isHovered) {
      isHovered = false;
      onHoverEnd?.();
    }
  };
  
  enable();
  
  return { enable, disable };
}

/**
 * ドラッグアンドドロップのセットアップ
 * @param {HTMLElement} draggable - ドラッグ可能な要素
 * @param {Object} options - オプション
 * @param {Function} options.onDragStart - ドラッグ開始時のコールバック
 * @param {Function} options.onDrag - ドラッグ中のコールバック
 * @param {Function} options.onDragEnd - ドラッグ終了時のコールバック
 * @returns {Object} - { enable, disable } メソッド
 */
export function setupDraggable(draggable, {
  onDragStart,
  onDrag,
  onDragEnd
} = {}) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  
  const handlePointerDown = (ev) => {
    ev.preventDefault();
    isDragging = true;
    startX = ev.clientX - currentX;
    startY = ev.clientY - currentY;
    
    draggable.setPointerCapture(ev.pointerId);
    onDragStart?.(ev, { x: currentX, y: currentY });
    
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  };
  
  const handlePointerMove = (ev) => {
    if (!isDragging) return;
    
    currentX = ev.clientX - startX;
    currentY = ev.clientY - startY;
    
    onDrag?.(ev, { x: currentX, y: currentY });
  };
  
  const handlePointerUp = (ev) => {
    if (!isDragging) return;
    
    isDragging = false;
    draggable.releasePointerCapture(ev.pointerId);
    
    onDragEnd?.(ev, { x: currentX, y: currentY });
    
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  
  const enable = () => {
    draggable.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
  };
  
  const disable = () => {
    draggable.removeEventListener('pointerdown', handlePointerDown);
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointercancel', handlePointerUp);
    
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  };
  
  enable();
  
  return { enable, disable };
}
