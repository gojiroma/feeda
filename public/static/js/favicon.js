const SIZE = 64;

// A plain static favicon — there's no unread state left to badge it with
// (see main.js), so this only ever needs to run once at boot instead of on
// every render.
export function setFavicon() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");

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

  const dataUrl = canvas.toDataURL("image/png");

  const old = document.querySelector('link[rel="icon"]');
  if (old) old.remove();
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = dataUrl;
  document.head.appendChild(link);
}
