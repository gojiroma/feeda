import { sanitizeHtmlToFragment } from "../sanitize.js";
import { highlightText, highlightFragment } from "../highlight.js";

// YouTube channel feeds (and single-video Atom/RSS feeds) link each entry
// straight to the video's watch page — e.g. https://www.youtube.com/watch?v=ID,
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

export function renderPreview(container, entry, query, { onLinkClick } = {}) {
  container.innerHTML = "";

  if (!entry) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "記事を選択してください。";
    container.appendChild(hint);
    return;
  }

  const h2 = document.createElement("h2");
  h2.className = "preview-title";
  h2.appendChild(highlightText(entry.title || "(タイトルなし)", query));
  container.appendChild(h2);

  const meta = document.createElement("div");
  meta.className = "preview-meta";
  const parts = [];
  if (entry.author) parts.push(entry.author);
  if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
  meta.textContent = parts.join(" ・ ");
  container.appendChild(meta);

  const videoId = youtubeVideoId(entry.link);
  if (videoId) {
    const wrap = document.createElement("div");
    wrap.className = "preview-video";
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
    iframe.title = entry.title || "YouTube video";
    iframe.frameBorder = "0";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    wrap.appendChild(iframe);
    container.appendChild(wrap);
  }

  if (entry.link) {
    const link = document.createElement("a");
    link.href = entry.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "preview-link";
    link.textContent = entry.link;
    if (onLinkClick) link.addEventListener("click", () => onLinkClick(entry));
    container.appendChild(link);
  }

  const body = document.createElement("div");
  body.className = "preview-body";
  const bodyFragment = sanitizeHtmlToFragment(entry.content || entry.summary || "");
  highlightFragment(bodyFragment, query);
  body.appendChild(bodyFragment);
  container.appendChild(body);
}
