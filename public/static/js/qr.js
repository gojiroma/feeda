// Thin wrapper around two vendored, dependency-free libraries. Both are
// loaded lazily (a plain <script> injected on first use, not a static tag
// in index.html) since neither is needed unless the user actually opens
// the QR share/scan UI — jsQR alone is ~250KB unminified, not worth adding
// to every page load for a rarely-used feature.
//
//  - vendor/qrcode-generator.js — pure-JS QR encoder, exposes a global
//    `qrcode(typeNumber, errorCorrectionLevel)` factory.
//  - vendor/jsQR.js — pure-JS QR decoder for camera-captured image data,
//    exposes a global `jsQR(imageData, width, height)` function.

const loadedScripts = new Map();

function loadScriptOnce(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(
      src,
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`スクリプトの読み込みに失敗しました: ${src}`));
        document.head.appendChild(script);
      })
    );
  }
  return loadedScripts.get(src);
}

// Renders a QR code encoding `text` as an SVG into `container`. The
// generated SVG always paints an explicit white background + black modules
// (see createSvgTag in the vendored library), so it stays scannable
// regardless of the page's light/dark theme.
export async function renderQrCode(container, text) {
  await loadScriptOnce("./static/js/vendor/qrcode-generator.js");
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

// Starts scanning `videoEl`'s camera feed for a QR code, calling `onDecode`
// with the decoded text the first time one is found (scanning then stops on
// its own). Returns a stop() function that releases the camera and cancels
// the scan loop — call it if the caller gives up (e.g. the modal is closed
// before anything was decoded); calling it twice is safe.
export async function startQrScanner(videoEl, onDecode) {
  await loadScriptOnce("./static/js/vendor/jsQR.js");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stopped = false;
  let rafId = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    stream.getTracks().forEach((track) => track.stop());
  }

  function tick() {
    if (stopped) return;
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (result && result.data) {
        stop();
        onDecode(result.data);
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
  return stop;
}
