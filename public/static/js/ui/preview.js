import { sanitizeHtmlToFragment } from "../sanitize.js";
import { highlightText, highlightFragment } from "../highlight.js";
import { renderAnnotatePopup } from "./articleList.js";
import { createElement } from "./domUtils.js";

// YouTube channel feeds (and single-video Atom/RSS feeds) link each entry
// straight to the video's watch page \u2014 e.g. https://www.youtube.com/watch?v=ID,
// https://www.youtube.com/shorts/ID, or the youtu.be short form. Matched
// against entry.link so a channel's video entries embed a player instead of
// just showing a plain outbound link.
function youtubeVideoId(link) {
  if (!link) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return id || null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shortsMatch) return shortsMatch[1];
  }
  return null;
}

function buildVideoWrap(videoId, title) {
  const wrap = createElement("div", { className: "preview-video" });
  const iframe = createElement("iframe", {
    src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
    title: title || "YouTube video",
    frameBorder: "0",
    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
    allowFullscreen: true
  });
  wrap.appendChild(iframe);
  return wrap;
}

export function renderPreview(
  container,
  entry,
  query,
  { onLinkClick, logEntry, onSetColor, onAddComment, onAddTag, onRemoveTag } = {}
) {
  // Coloring/commenting an entry from the preview pane's own annotate
  // section re-renders the whole preview (see main.js's setEntryLogColor/
  // addEntryLogComment \u2192 render() \u2192 renderPreview) even though the entry
  // being previewed hasn't changed. A plain rebuild would tear down and
  // recreate the YouTube <iframe> below, which reloads the embed and blows
  // away playback position/state for no reason \u2014 so when the same video is
  // still showing, the existing iframe wrapper is pulled out before the
  // container is cleared and reused as-is instead of rebuilt.
  const videoId = entry ? youtubeVideoId(entry.link) : null;
  const reusableVideoWrap =
    videoId && container.dataset.previewVideoId === videoId ? container.querySelector(".preview-video") : null;

  // Same rebuild-wipes-live-state problem as the video iframe above, but for
  // the annotate section's "add a comment" input: renderPreview reruns on
  // every app render, including a mere mouseenter over another article-list
  // row or a background sync completing (see main.js's previewFeed/
  // previewEntry and periodic refreshAll/scheduleLogSync) \u2014 none of which
  // change what's being previewed. Without this, a comment mid-typed here
  // gets silently wiped by the rebuild below. Only restore it when it's
  // still the same entry being previewed (a real navigation to a different
  // entry must not leak one entry's unsent draft into another's box) and the
  // input still had focus (nothing to preserve otherwise).
  const sameEntry = entry && container.dataset.previewEntryId === entry.id;
  const previousCommentInput = sameEntry ? container.querySelector(".preview-annotate .reflect-comment-input") : null;
  const preservedComment =
    previousCommentInput && document.activeElement === previousCommentInput
      ? {
          value: previousCommentInput.value,
          selectionStart: previousCommentInput.selectionStart,
          selectionEnd: previousCommentInput.selectionEnd,
        }
      : null;

  container.innerHTML = "";

  if (!entry) {
    delete container.dataset.previewVideoId;
    delete container.dataset.previewEntryId;
    const hint = createElement("p", {
      className: "empty-hint",
      textContent: "\u8a18\u4e8b\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
    });
    container.appendChild(hint);
    return;
  }

  container.dataset.previewEntryId = entry.id;

  const h2 = createElement("h2", { className: "preview-title" });
  h2.appendChild(highlightText(entry.title || "(\u30bf\u30a4\u30c8\u30eb\u306a\u3057)", query));
  container.appendChild(h2);

  const meta = createElement("div", { className: "preview-meta" });
  const parts = [];
  if (entry.author) parts.push(entry.author);
  if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
  meta.textContent = parts.join(" \u30fb ");
  container.appendChild(meta);

  if (videoId) {
    container.appendChild(reusableVideoWrap || buildVideoWrap(videoId, entry.title));
    container.dataset.previewVideoId = videoId;
  } else {
    delete container.dataset.previewVideoId;
  }

  if (entry.link) {
    const link = createElement("a", {
      href: entry.link,
      target: "_blank",
      rel: "noopener noreferrer",
      className: "preview-link",
      textContent: entry.link
    });
    if (onLinkClick) link.addEventListener("click", () => onLinkClick(entry));
    container.appendChild(link);
  }

  const body = createElement("div", { className: "preview-body" });
  const bodyFragment = sanitizeHtmlToFragment(entry.content || entry.summary || "");
  highlightFragment(bodyFragment, query);
  body.appendChild(bodyFragment);
  container.appendChild(body);

  // Same color-swatch-plus-comment-thread UI as the article list's
  // right-click/long-press popup (see renderAnnotatePopup), just always
  // visible here instead of opened on request \u2014 reading an entry in the
  // preview pane is itself a natural place to tag or comment on it without
  // having to go back and right-click its row. Only offered when the caller
  // actually wired up handlers for it (main.js's renderDesktop/renderWideGrid);
  // the tablet/mobile layouts have no preview pane to hang this off of.
  if (onSetColor && onAddComment) {
    const annotateWrap = createElement("div", { className: "preview-annotate" });
    renderAnnotatePopup(annotateWrap, { logEntry, onSetColor, onAddComment, onAddTag, onRemoveTag, autoFocus: false });
    container.appendChild(annotateWrap);

    if (preservedComment) {
      const newCommentInput = annotateWrap.querySelector(".reflect-comment-input");
      if (newCommentInput) {
        newCommentInput.value = preservedComment.value;
        newCommentInput.focus();
        newCommentInput.setSelectionRange(preservedComment.selectionStart, preservedComment.selectionEnd);
      }
    }
  }
}
