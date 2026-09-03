import { highlightText } from "../highlight.js";
import { extractArticlePreview } from "../sanitize.js";
import { COLOR_BY_KEY } from "../colorPalette.js";
import { renderColorSwatches } from "./colorPicker.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, setCustomProperty } from "./domUtils.js";

const COMMENT_PREVIEW_MAX_LENGTH = 60;

// Which entry's hover-revealed annotate section (see buildAnnotateSection)
// the pointer is currently over — tracked here at module scope, outside any
// one render, because :hover/:focus-within alone can't survive a rebuild.
// container.innerHTML = "" (see renderArticleList) destroys the hovered
// row and replaces it with a new element sitting at the same screen
// position; the browser doesn't retroactively apply :hover to that new
// element until the pointer actually moves again, so without this the
// section would flash shut — and a .focus() into its now-hidden comment
// input would silently no-op — every time picking a color or adding a
// comment triggers a re-render out from under a still-hovering mouse.
// buildArticleItem reapplies the open state at creation time for whichever
// entry this was last set to; real mouseenter/mouseleave on the fresh
// element then keep it in sync with wherever the pointer actually is.
let hoveredEntryId = null;

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

// Color-swatch row + comment thread/add-form for one article — shared by
// the article list's own hover-revealed section (see buildArticleItem) and
// the preview pane's always-visible copy (see ui/preview.js, which imports
// this directly). autoFocus is only meaningful for the latter: the article
// list's copy opens purely on hover, where stealing focus into its input
// would be surprising, but the preview pane's copy is the deliberate result
// of clicking into an article, where focusing the comment box is a
// reasonable convenience.
export function renderAnnotateInline(container, { logEntry, onSetColor, onAddComment, autoFocus = false }) {
  container.innerHTML = "";

  const paletteRow = createElement("div", { className: "annotate-palette-row" });
  renderColorSwatches(paletteRow, { currentColor: logEntry ? logEntry.color : null, onSetColor });
  container.appendChild(paletteRow);

  const comments = logEntry ? logEntry.comments || [] : [];
  if (comments.length > 0) {
    const list = createElement("ul", { className: "reflect-comment-list" });
    for (const comment of comments) {
      const li = createElement("li", { className: "reflect-comment-item" });
      const time = createElement("span", {
        className: "reflect-comment-time",
        textContent: formatCommentTime(comment.createdAt)
      });
      li.appendChild(time);
      const text = createElement("span", {
        className: "reflect-comment-text",
        textContent: comment.text
      });
      li.appendChild(text);
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  const form = createElement("form", { className: "article-annotate-form" });
  const input = createElement("input", {
    type: "text",
    className: "reflect-comment-input",
    placeholder: "コメントを追加…"
  });
  form.appendChild(input);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    onAddComment(text);
  });
  container.appendChild(form);
  if (autoFocus) input.focus();
  return container;
}

// One article row in the middle pane — clicking it selects the entry for
// the preview pane (see main.js's onOpen/openEntry) rather than navigating
// away; the real link only ever opens from the preview pane itself.
function buildArticleItem(entry, { feedTitleById, selectedEntryId, query, onOpen, onSetColor, onAddComment, onRowMounted, logByEntryId, showFeedName, forceOpenEntryId }) {
  const logEntry = logByEntryId ? logByEntryId.get(entry.id) : null;
  const comments = logEntry ? logEntry.comments || [] : [];
  const rgb = logEntry && logEntry.color && COLOR_BY_KEY.get(logEntry.color);
  // See hoveredEntryId above — also forced open for whichever entry had its
  // comment input focused right before this render (a comment mid-typed
  // when a re-render lands must not silently drop out of view).
  const annotateOpen = entry.id === hoveredEntryId || entry.id === forceOpenEntryId;

  const li = createElement("li", {
    dataset: { entryId: entry.id },
    className: (
      "mobile-article-item" +
      (entry.id === selectedEntryId ? " selected" : "") +
      (rgb || comments.length > 0 ? " article-item--annotated" : "") +
      (rgb ? " article-item--colored" : "") +
      (annotateOpen ? " article-item--annotate-open" : "")
    )
  });
  if (rgb) setCustomProperty(li, "reflect-color", rgb);
  if (onSetColor || onAddComment) {
    li.addEventListener("mouseenter", () => {
      hoveredEntryId = entry.id;
      li.classList.add("article-item--annotate-open");
    });
    li.addEventListener("mouseleave", () => {
      if (hoveredEntryId === entry.id) hoveredEntryId = null;
      li.classList.remove("article-item--annotate-open");
    });
  }

  const row = createElement("div", { className: "mobile-article-row" });
  row.addEventListener("click", () => onOpen(entry));

  const { imageSrc, snippet } = extractArticlePreview(entry.content || entry.summary || "");

  if (imageSrc) {
    const thumb = createElement("img", {
      className: "article-thumb",
      src: imageSrc,
      alt: "",
      loading: "lazy"
    });
    row.appendChild(thumb);
  }

  const main = createElement("div", { className: "article-main" });

  const title = createElement("div", { className: "article-title" });
  title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
  main.appendChild(title);

  const meta = createElement("div", { className: "article-meta" });
  const parts = [];
  if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
  if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
  meta.textContent = parts.join(" ・ ");
  main.appendChild(meta);

  if (comments.length > 0) {
    const preview = createElement("div", {
      className: "article-comment-preview",
      textContent: `💬 ${truncate(comments[comments.length - 1].text, COMMENT_PREVIEW_MAX_LENGTH)}`
    });
    main.appendChild(preview);
  }

  if (snippet) {
    const snippetEl = createElement("div", { className: "article-snippet" });
    snippetEl.appendChild(highlightText(snippet, query));
    main.appendChild(snippetEl);
  }

  row.appendChild(main);
  li.appendChild(row);

  // Color palette + comment form, revealed on hover/focus (see
  // .article-annotate-inline in style.css) — a sibling of `row`, not nested
  // inside it, so its buttons/input don't fight the row's own click-to-select.
  if (onSetColor || onAddComment) {
    li.appendChild(
      renderAnnotateInline(createElement("div", { className: "article-annotate-inline" }), {
        logEntry,
        onSetColor: (color) => onSetColor(entry, color),
        onAddComment: (text) => onAddComment(entry, text),
      })
    );
  }

  onRowMounted?.(li, entry);

  return li;
}

export function renderArticleList(
  container,
  {
    entries,
    feedTitleById,
    selectedEntryId,
    query,
    onOpen,
    onSetColor,
    onAddComment,
    onRowMounted,
    logByEntryId,
    showFeedName,
    emptyHint,
  }
) {
  // Same rebuild-wipes-live-state problem reflect's own timeline redraw
  // works around (see renderReflectTimeline in reflect.js) — a comment
  // mid-typed into one row's hover-revealed form would otherwise vanish on
  // every unrelated re-render (a color/comment change elsewhere in the
  // list, ...). Only restore it onto the same entry's box and only when
  // that input still has focus.
  const focusedCommentLi = document.activeElement?.closest?.(".mobile-article-item");
  const focusedCommentInput = focusedCommentLi?.querySelector(".reflect-comment-input");
  const preservedComment =
    focusedCommentInput && document.activeElement === focusedCommentInput
      ? {
          entryId: focusedCommentLi.dataset.entryId,
          value: focusedCommentInput.value,
          selectionStart: focusedCommentInput.selectionStart,
          selectionEnd: focusedCommentInput.selectionEnd,
        }
      : null;

  container.innerHTML = "";

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "記事がありません。");
    return;
  }

  const itemProps = {
    feedTitleById,
    selectedEntryId,
    query,
    onOpen,
    onSetColor,
    onAddComment,
    onRowMounted,
    logByEntryId,
    forceOpenEntryId: preservedComment?.entryId,
  };

  const ul = createElement("ul", { className: "mobile-article-list-inner" });
  for (const entry of entries) {
    ul.appendChild(buildArticleItem(entry, { ...itemProps, showFeedName }));
  }
  container.appendChild(ul);
  restorePreservedComment(container, preservedComment);
}

function restorePreservedComment(container, preservedComment) {
  if (!preservedComment) return;
  const restoredLi = container.querySelector(`.mobile-article-item[data-entry-id="${CSS.escape(preservedComment.entryId)}"]`);
  const restoredInput = restoredLi?.querySelector(".reflect-comment-input");
  if (!restoredInput) return;
  restoredInput.value = preservedComment.value;
  restoredInput.focus();
  restoredInput.setSelectionRange(preservedComment.selectionStart, preservedComment.selectionEnd);
}
