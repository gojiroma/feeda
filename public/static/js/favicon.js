const SIZE = 64;

function drawBaseIcon(ctx) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const r = SIZE / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = "#2563eb";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${SIZE * 0.55}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("f", r, r + SIZE * 0.04);
}

function drawBadge(ctx, count) {
  const label = count > 99 ? "99+" : String(count);
  const badgeR = SIZE * 0.32;
  const cx = SIZE - badgeR * 0.9;
  const cy = badgeR * 0.9;

  ctx.beginPath();
  ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = "#dc2626";
  ctx.fill();
  ctx.lineWidth = SIZE * 0.04;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 2 ? SIZE * 0.24 : SIZE * 0.3}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + SIZE * 0.02);
}

// Renders the favicon with a badge showing the number of *sources* (feeds)
// that have unread content — not the total unread article count — and
// swaps it into <head>. The <link> is removed and re-inserted rather than
// having its href updated in place, since some browsers don't repaint the
// tab icon on a plain attribute change.
export function updateFavicon(unreadSourceCount) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

  drawBaseIcon(ctx);
  if (unreadSourceCount > 0) drawBadge(ctx, unreadSourceCount);

  const dataUrl = canvas.toDataURL("image/png");

  const old = document.querySelector('link[rel="icon"]');
  if (old) old.remove();
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = dataUrl;
  document.head.appendChild(link);
}
