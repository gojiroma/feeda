// Shared muted color-tagging palette — right-click/long-press color pickers
// throughout the app (reflect log entries, the feed list) all draw from this
// one list so the available colors and their meaning stay consistent. Muted
// on purpose, meant to sit quietly behind text rather than compete with it.
// Values are "R,G,B" triplets fed into a --*-color CSS custom property by
// whichever UI is using them (see --reflect-color / --feed-color in
// style.css) — this is the single source of truth for the palette, so
// nothing needs to be kept in sync in CSS separately.
export const COLOR_PALETTE = [
  { key: "1", rgb: "184,110,110" }, // dusty rose
  { key: "2", rgb: "196,145,90" }, // clay
  { key: "3", rgb: "190,165,90" }, // ochre
  { key: "4", rgb: "120,150,100" }, // sage
  { key: "5", rgb: "95,150,140" }, // teal
  { key: "6", rgb: "100,130,170" }, // slate blue
  { key: "7", rgb: "120,115,175" }, // indigo
  { key: "8", rgb: "150,110,165" }, // mauve
  { key: "9", rgb: "180,120,150" }, // dusty pink
  { key: "10", rgb: "130,130,130" }, // gray
];
export const COLOR_BY_KEY = new Map(COLOR_PALETTE.map((c) => [c.key, c.rgb]));

// Stable per-word color, used to give each saved search-history term its
// own distinct highlight/chip color (see main.js's highlightQuery and
// ui/searchBar.js's history bar) without persisting a color assignment
// anywhere — the same word always hashes to the same palette entry, so its
// color stays consistent across renders, reloads, and between the two
// places (highlight marks, history chips) that both need to agree on it.
export function colorForWord(word) {
  let hash = 5381;
  for (let i = 0; i < word.length; i++) {
    hash = (hash * 33) ^ word.charCodeAt(i);
  }
  const idx = Math.abs(hash) % COLOR_PALETTE.length;
  return COLOR_PALETTE[idx].rgb;
}
