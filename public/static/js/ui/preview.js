import { sanitizeHtmlToFragment } from "../sanitize.js";
import { highlightText, highlightFragment } from "../highlight.js";
import { createElement } from "./domUtils.js";

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

export function renderPreview(container, entry, query) {
  // Coloring/commenting an entry from the article list re-renders the whole
  // preview even though the entry being previewed hasn't changed. A plain
  // rebuild would tear down and recreate the YouTube <iframe> below, which
  // reloads the embed and blows away playback position/state for no reason
  // — so when the same video is still showing, the existing iframe wrapper
  // is pulled out before the container is cleared and reused as-is instead
  // of rebuilt.
  const videoId = entry ? youtubeVideoId(entry.link) : null;
  const reusableVideoWrap =
    videoId && container.dataset.previewVideoId === videoId ? container.querySelector(".preview-video") : null;

  container.innerHTML = "";

  if (!entry) {
    delete container.dataset.previewVideoId;
    const hint = createElement("p", {
      className: "empty-hint",
      textContent: "記事を選択してください。"
    });
    container.appendChild(hint);
    return;
  }

  const h2 = createElement("h2", { className: "preview-title" });
  h2.appendChild(highlightText(entry.title || "(タイトルなし)", query));
  container.appendChild(h2);

  const meta = createElement("div", { className: "preview-meta" });
  const parts = [];
  if (entry.author) parts.push(entry.author);
  if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
  meta.textContent = parts.join(" ・ ");
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
    container.appendChild(link);
  }

  const body = createElement("div", { className: "preview-body" });
  const bodyFragment = sanitizeHtmlToFragment(entry.content || entry.summary || "");
  highlightFragment(bodyFragment, query);
  body.appendChild(bodyFragment);
  container.appendChild(body);
}
