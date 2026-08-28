import { createShareLink, invalidateShareLink } from "../shareLink.js";
import { setupModalWithCloseBtn, setupCopyModal } from "./modalUtils.js";
import { renderEmptyHint } from "./listUtils.js";

function formatExpiry(expiresAtIso) {
  const d = new Date(expiresAtIso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

// Wires the "一時URLで共有" flow (opened from the seed modal, same as the
// QR/6-digit hand-offs in pairingModal.js) — generates a one-time link that
// hands full, normal-permission access to whoever opens it, without ever
// showing them the raw seed (see session.js's initEphemeralSession) and
// without granting anything beyond the single browser tab that opens it.
export function setupShareLinkUI({ getSeed, getApiBase }) {
  const openBtn = document.getElementById("seed-link-share-btn");
  const modal = document.getElementById("link-share-modal");
  const urlInput = document.getElementById("link-share-url");
  const copyBtn = document.getElementById("link-share-copy-btn");
  const statusEl = document.getElementById("link-share-status");
  const closeBtn = document.getElementById("link-share-close-btn");

  function close() {
    modal.classList.add("hidden");
  }

  // The link just shown, if any — so generating a new one can invalidate it
  // first (see below). SHARE_LINK_TTL_SECONDS is hours-long, so without
  // this a re-share (e.g. the first link went to the wrong person, or the
  // owner just wants a fresh one) would leave the old link sitting around
  // valid for hours instead of expiring with the modal.
  let lastGeneratedId = null;

  function open() {
    urlInput.value = "";
    statusEl.textContent = "リンクを発行しています…";
    modal.classList.remove("hidden");
    const apiBase = getApiBase();
    if (lastGeneratedId) {
      invalidateShareLink(apiBase, lastGeneratedId).catch((err) =>
        console.error("[feeda] previous share link invalidation failed", err)
      );
      lastGeneratedId = null;
    }
    generateLink();
  }

  async function generateLink() {
    try {
      const { id, url, expiresAt } = await createShareLink(getApiBase(), getSeed());
      lastGeneratedId = id;
      urlInput.value = url;
      statusEl.textContent = `このリンクを開くと一回だけアクセスできます。相手がタブを閉じるとアクセスできなくなります。〈${formatExpiry(expiresAt)}まで有効。`;
    } catch (err) {
      console.error("[feeda] share link creation failed", err);
      statusEl.textContent = `リンクの発行に失敗しました: ${err.message}`;
    }
  }

  // 共通モーダルセットアップ
  setupModalWithCloseBtn(openBtn, modal, "link-share-close-btn", {
    onOpen: open,
    onClose: close,
    closeOnBackgroundClick: true,
    closeOnEscape: true
  });

  // コピーボタンのセットアップ
  setupCopyModal(null, modal, "link-share-copy-btn", () => urlInput.value, {});
}
