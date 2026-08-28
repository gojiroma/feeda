import { createShareLink, invalidateShareLink } from "../shareLink.js";
import { setupModalWithCloseBtn, setupCopyModal } from "./modalUtils.js";
import { renderEmptyHint } from "./listUtils.js";

function formatExpiry(expiresAtIso) {
  const d = new Date(expiresAtIso);
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

// Wires the "\u4e00\u6642URL\u3067\u5171\u6709" flow (opened from the seed modal, same as the
// QR/6-digit hand-offs in pairingModal.js) \u2014 generates a one-time link that
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

  // The link just shown, if any \u2014 so generating a new one can invalidate it
  // first (see below). SHARE_LINK_TTL_SECONDS is hours-long, so without
  // this a re-share (e.g. the first link went to the wrong person, or the
  // owner just wants a fresh one) would leave the old link sitting around
  // valid for hours instead of expiring with the modal.
  let lastGeneratedId = null;

  function open() {
    urlInput.value = "";
    statusEl.textContent = "\u30ea\u30f3\u30af\u3092\u767a\u884c\u3057\u3066\u3044\u307e\u3059\u2026";
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
      statusEl.textContent = `\u3053\u306e\u30ea\u30f3\u30af\u3092\u958b\u304f\u3068\u4e00\u56de\u3060\u3051\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u3059\u3002\u76f8\u624b\u304c\u30bf\u30d6\u3092\u9589\u3058\u308b\u3068\u30a2\u30af\u30bb\u30b9\u3067\u304d\u306a\u304f\u306a\u308a\u307e\u3059\u3002\u3008${formatExpiry(expiresAt)}\u307e\u3067\u6709\u52b9\u3002`;
    } catch (err) {
      console.error("[feeda] share link creation failed", err);
      statusEl.textContent = `\u30ea\u30f3\u30af\u306e\u767a\u884c\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${err.message}`;
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
