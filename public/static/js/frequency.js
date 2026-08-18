const GROUPS = [
  { key: "daily", label: "毎日", maxAvgDays: 1.5 },
  { key: "several-per-week", label: "週数回", maxAvgDays: 4 },
  { key: "weekly", label: "週1回程度", maxAvgDays: 9 },
  { key: "monthly", label: "月1回程度", maxAvgDays: 45 },
  { key: "rare", label: "それ以下", maxAvgDays: Infinity },
];
const UNKNOWN_GROUP = { key: "unknown", label: "頻度不明" };
// Feeds the user paused (long-press/right-click on the feed name) sort into
// their own group at the very bottom regardless of actual posting
// frequency — see groupFeedsByFrequency below.
const PAUSED_GROUP = { key: "paused", label: "取得しない" };
// Feeds that are still fetching normally but have nothing unread right now
// — kept out of the frequency groups (which are meant to say "here's what's
// new") and parked in their own bucket just below the paused feeds instead
// of being hidden entirely.
const FETCHING_GROUP = { key: "fetching", label: "取得する" };
const SAMPLE_SIZE = 20;

// Most-frequent-first, so an initial scan (or one on a fresh device that
// has no local fetch history yet but did pull synced frequencyGroup values
// from other devices — see feed.frequencyGroup) fetches daily feeds before
// rarely-updated ones. Also the basis for MOBILE_FREQUENCY_ORDER (main.js),
// which reverses it. Deliberately NOT used for the feed-list sidebar's
// display order — see FEED_LIST_ORDER below.
export const FREQUENCY_ORDER = [...GROUPS.map((g) => g.key), UNKNOWN_GROUP.key, PAUSED_GROUP.key];

// Display order for the desktop feed-list sidebar (see groupFeedsByFrequency
// below). Deliberately different from FREQUENCY_ORDER: with "daily" pinned
// at the very top, it's too easy to only ever check the same handful of
// very active feeds and let everything else go unread. Bumping "daily" down
// to just above the paused group — while every other group keeps the same
// relative order — puts the easy-to-miss, less-frequent feeds first without
// touching fetch priority, which still fetches daily feeds first (see
// refreshAll in main.js, which sorts by FREQUENCY_ORDER, not this).
export const FEED_LIST_ORDER = [
  ...GROUPS.filter((g) => g.key !== "daily").map((g) => g.key),
  UNKNOWN_GROUP.key,
  "daily",
  PAUSED_GROUP.key,
  FETCHING_GROUP.key,
];

// How long to wait before re-fetching a feed, based on its own posting
// frequency. Kept client-side only (see nextCheckAt on the feed record) so
// a large subscription list doesn't mean re-fetching everything, from every
// origin server, on every page load — daily feeds get checked often, rare
// ones rarely.
const CHECK_INTERVAL_MS = {
  daily: 2 * 60 * 60 * 1000,
  "several-per-week": 6 * 60 * 60 * 1000,
  weekly: 24 * 60 * 60 * 1000,
  monthly: 3 * 24 * 60 * 60 * 1000,
  rare: 7 * 24 * 60 * 60 * 1000,
  unknown: 6 * 60 * 60 * 1000,
};

export function nextCheckDelayMs(groupKey) {
  return CHECK_INTERVAL_MS[groupKey] ?? CHECK_INTERVAL_MS.unknown;
}

export function computeFrequencyGroup(entries) {
  const dated = entries
    .map((e) => e.pubDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)
    .slice(0, SAMPLE_SIZE);

  if (dated.length < 2) return UNKNOWN_GROUP;

  const diffsDays = [];
  for (let i = 0; i < dated.length - 1; i++) {
    diffsDays.push((dated[i] - dated[i + 1]) / 86400000);
  }
  const avgDays = diffsDays.reduce((a, b) => a + b, 0) / diffsDays.length;

  return GROUPS.find((g) => avgDays <= g.maxAvgDays) || GROUPS[GROUPS.length - 1];
}

// Feeds with dated entries sort by their newest entry's date, newest first.
// Date-less feeds have no publish date to go by, so they sort by when they
// were last fetched instead — a freshly-fetched date-less feed (which just
// had its content-hash checked and possibly changed) rises to the top.
function feedSortTimestamp(feed, entries) {
  const dated = entries
    .map((e) => e.pubDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  if (dated.length > 0) return Math.max(...dated);
  return feed.lastFetchedAt ? new Date(feed.lastFetchedAt).getTime() : 0;
}

export function groupFeedsByFrequency(feedsWithEntries) {
  const groups = new Map();
  for (const { feed, entries } of feedsWithEntries) {
    const group = feed.paused ? PAUSED_GROUP : feed.hasUnread ? computeFrequencyGroup(entries) : FETCHING_GROUP;
    if (!groups.has(group.key)) groups.set(group.key, { group, feeds: [] });
    groups.get(group.key).feeds.push({ feed, sortTimestamp: feedSortTimestamp(feed, entries) });
  }
  for (const { feeds } of groups.values()) {
    feeds.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  }
  return FEED_LIST_ORDER.filter((key) => groups.has(key)).map((key) => {
    const { group, feeds } = groups.get(key);
    return { group, feeds: feeds.map((f) => f.feed) };
  });
}
