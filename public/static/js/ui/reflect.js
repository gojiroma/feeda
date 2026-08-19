// "振り返る" (reflect) mode's daily timeline: one row per logged article
// open, oldest first, each with its own stacked comment thread. See
// logbook.js for the data shape and main.js's renderReflect for how a day's
// entries get here.

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

function renderComment(comment) {
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

  return li;
}

function renderLogItem(logEntry, onAddComment) {
  const li = document.createElement("li");
  li.className = "reflect-log-item";

  const time = document.createElement("div");
  time.className = "reflect-log-time";
  time.textContent = formatTime(logEntry.openedAt);
  li.appendChild(time);

  const body = document.createElement("div");
  body.className = "reflect-log-body";

  const titleLink = document.createElement("a");
  titleLink.className = "reflect-log-title";
  titleLink.href = logEntry.url || "#";
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.textContent = logEntry.title || "(タイトルなし)";
  body.appendChild(titleLink);

  if (logEntry.feedTitle) {
    const meta = document.createElement("div");
    meta.className = "reflect-log-meta";
    meta.textContent = logEntry.feedTitle;
    body.appendChild(meta);
  }

  const comments = logEntry.comments || [];
  if (comments.length > 0) {
    const commentList = document.createElement("ul");
    commentList.className = "reflect-comment-list";
    for (const comment of comments) commentList.appendChild(renderComment(comment));
    body.appendChild(commentList);
  }

  // The add-comment form is hidden by default (see .reflect-comment-form in
  // style.css) — an input on every single entry was too much visual noise
  // for a timeline meant to be skimmed. It shows on mouse hover for free via
  // CSS; this toggle button is the touch/tap equivalent, since touch has no
  // hover to reveal it with.
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "reflect-comment-toggle";
  toggleBtn.textContent = "コメント";
  toggleBtn.addEventListener("click", () => {
    li.classList.toggle("comments-open");
    if (li.classList.contains("comments-open")) input.focus();
  });
  body.appendChild(toggleBtn);

  const form = document.createElement("form");
  form.className = "reflect-comment-form";
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
    onAddComment(logEntry.id, text);
  });
  body.appendChild(form);

  li.appendChild(body);
  return li;
}

export function renderReflectTimeline(container, { entries, onAddComment, emptyHint }) {
  container.innerHTML = "";

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyHint || "この日はまだ記録がありません。";
    container.appendChild(hint);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "reflect-timeline-list";
  for (const logEntry of entries) ul.appendChild(renderLogItem(logEntry, onAddComment));
  container.appendChild(ul);
}
