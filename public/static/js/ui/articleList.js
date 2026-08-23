import { highlightText } from "../highlight.js";
import { COLOR_BY_KEY } from "../colorPalette.js";
import { attachContextTrigger, renderColorSwatches, closeFloatingPopupIfMissing } from "./colorPicker.js";
import { extractArticlePreview } from "../sanitize.js";

const COMMENT_PREVIEW_MAX_LENGTH = 60;

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

// Content of the annotate popup opened from an article row (see onAnnotate
// above and main.js's showAnnotatePopup) — a color-swatch row plus the same
// comment thread/add-form reflect's timeline shows per entry. Also reused
// as-is for the always-visible copy under the preview pane's body (see
// preview.js's renderPreview) — the only difference there is autoFocus:
// false, since that copy redraws on every app render (a hovered article,
// a background refetch, ...) and stealing focus back into its comment
// input each time would make it unusable while the popup's one-shot open
// wants exactly that. logEntry may be null there too (previewing/hovering
// an entry doesn't log it until the user actually acts on it — see
// ensureLogEntryForEntry in main.js), so this renders an empty/uncolored
// state rather than assuming one already exists.
export function renderAnnotatePopup(container, { logEntry, onSetColor, onAddComment, autoFocus = true }) {
  container.innerHTML = "";

  const swatchRow = document.createElement("div");
  swatchRow.className = "article-annotate-swatches";
  renderColorSwatches(swatchRow, { currentColor: logEntry ? logEntry.color : null, onSetColor });
  container.appendChild(swatchRow);

  const comments = logEntry ? logEntry.comments || [] : [];
  if (comments.length > 0) {
    const list = document.createElement("ul");
    list.className = "reflect-comment-list";
    for (const comment of comments) {
      const li = document.createElement("li");
      li.className = "reflect-comment-item";
      const time = document.createElement("span");
      time.className = "reflect-comment-time";
      time.textContent = formatCommentTime(comment.createdAt);
      li.appendChild(time);
      const text = document.createElement("span");
      text.className = "reflect-comment-text";
      text.textContent = comment.text;
      li.appendChild(text);
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  const form = document.createElement("form");
  form.className = "article-annotate-form";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "reflect-comment-input";
  input.placeholder = "コメントを追加…";
  form.appendChild(input);
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "追加";
  form.appendChild(submitBtn);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    onAddComment(text);
  });
  container.appendChild(form);
  if (autoFocus) input.focus();
}

export function renderArticleList(
  container,
  { entries, feedTitleById, selectedEntryId, query, isUnread, onSelect, onHover, onAnnotate, logByEntryId, showFeedName, emptyHint }
) {
  container.innerHTML = "";
  // Same "don't slam shut on an unrelated redraw" rule as reflect's own
  // color picker (see reflect.js's renderReflectTimeline) — only close the
  // annotate popup once the entry it's anchored to has actually dropped out
  // of the list (feed switched away, search cleared it, ...).
  closeFloatingPopupIfMissing(new Set(entries.map((e) => e.id)));

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyHint || "記事がありません。";
    container.appendChild(hint);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "article-list";

  for (const entry of entries) {
    const logEntry = logByEntryId ? logByEntryId.get(entry.id) : null;
    const comments = logEntry ? logEntry.comments || [] : [];
    const rgb = logEntry && logEntry.color && COLOR_BY_KEY.get(logEntry.color);

    const li = document.createElement("li");
    li.className =
      "article-item" +
      (entry.id === selectedEntryId ? " selected" : "") +
      (isUnread(entry) ? " unread" : "") +
      // Colored and/or commented from reflect (or right here — see
      // onAnnotate below) stand out from the rest of the list: a left
      // border/background tint for the color, both alone if there's no
      // color but a comment exists.
      (rgb || comments.length > 0 ? " article-item--annotated" : "") +
      (rgb ? " article-item--colored" : "");
    if (rgb) li.style.setProperty("--reflect-color", rgb);
    li.addEventListener("click", () => onSelect(entry));
    // Hovering previews too (touch has no hover, so this is mouse/stylus
    // only) but must NOT mark the entry read — see onHover in main.js.
    // Skipped when this entry is already selected: onHover triggers a full
    // re-render, which tears down and rebuilds this <li>; without the
    // guard, the pointer landing on its own replacement would re-fire
    // mouseenter and loop.
    li.addEventListener("mouseenter", () => {
      if (entry.id === selectedEntryId) return;
      onHover(entry);
    });

    const { imageSrc, snippet } = extractArticlePreview(entry.content || entry.summary || "");

    if (imageSrc) {
      const thumb = document.createElement("img");
      thumb.className = "article-thumb";
      thumb.src = imageSrc;
      thumb.alt = "";
      thumb.loading = "lazy";
      li.appendChild(thumb);
    }

    const main = document.createElement("div");
    main.className = "article-main";

    const title = document.createElement("div");
    title.className = "article-title";
    title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
    main.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "article-meta";
    const parts = [];
    if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
    if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
    meta.textContent = parts.join(" ・ ");
    main.appendChild(meta);

    if (snippet) {
      const snippetEl = document.createElement("div");
      snippetEl.className = "article-snippet";
      snippetEl.appendChild(highlightText(snippet, query));
      main.appendChild(snippetEl);
    }

    if (comments.length > 0) {
      const preview = document.createElement("div");
      preview.className = "article-comment-preview";
      preview.textContent = `💬 ${truncate(comments[comments.length - 1].text, COMMENT_PREVIEW_MAX_LENGTH)}`;
      main.appendChild(preview);
    }

    li.appendChild(main);

    // Right-click (desktop) or long-press (touch) opens a combined
    // color-tag + comment popup — same interaction reflect's own timeline
    // uses (see reflect.js), but reachable straight from the news list. Not
    // a hover-revealed inline form: unlike reflect's timeline, this list
    // marks read on hover-triggered re-renders (see onHover above), and a
    // form whose visibility (and thus this row's height) changed on hover
    // would reflow the rows below it under a still-stationary cursor,
    // cascading into their mouseenter firing too — see .article-item's own
    // comment in style.css. A floating, position-fixed popup never touches
    // this row's layout, so it sidesteps that entirely.
    if (onAnnotate) {
      attachContextTrigger(li, {
        onOpenRequest: (x, y) => onAnnotate(entry, x, y),
      });
    }

    ul.appendChild(li);
  }

  container.appendChild(ul);
}
