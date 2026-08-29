// Frequency groups, most-frequent-first. The "daily" range (avgDays <= 1.5,
// i.e. roughly one post per day or more often) is split into five posts-
// per-day tiers instead of one lump "毎日" bucket, since a feed that posts
// 20 times a day and one that posts once a day both used to land in the
// same group. Each tier's maxAvgDays is 1 / (that tier's posts-per-day),
// except the bottom tier (daily-1) which keeps the original 1.5-day cutoff
// so the boundary against "several-per-week" doesn't move.
const GROUPS = [
  { key: "daily-20", label: "1日20回以上", maxAvgDays: 1 / 20 },
  { key: "daily-10", label: "1日10回", maxAvgDays: 1 / 10 },
  { key: "daily-5", label: "1日5回", maxAvgDays: 1 / 5 },
  { key: "daily-3", label: "1日3回", maxAvgDays: 1 / 3 },
  { key: "daily-1", label: "1日1回", maxAvgDays: 1.5 },
  { key: "several-per-week", label: "週数回", maxAvgDays: 4 },
  { key: "weekly", label: "週1回程度", maxAvgDays: 9 },
  { key: "monthly", label: "月1回程度", maxAvgDays: 45 },
  { key: "rare", label: "それ以下", maxAvgDays: Infinity },
];
const UNKNOWN_GROUP = { key: "unknown", label: "頻度不明" };
const SAMPLE_SIZE = 20;

// Most-frequent-first, so an initial scan (or one on a fresh device that
// has no local fetch history yet but did pull synced frequencyGroup values
// from other devices — see feed.frequencyGroup) fetches daily feeds before
// rarely-updated ones — see refreshAll's own dueFeeds sort in main.js.
export const FREQUENCY_ORDER = [...GROUPS.map((g) => g.key), UNKNOWN_GROUP.key, "paused"];

// How long to wait before re-fetching a feed, based on its own posting
// frequency. Kept client-side only (see nextCheckAt on the feed record) so
// a large subscription list doesn't mean re-fetching everything, from every
// origin server, on every page load — the more often a feed posts, the more
// often it's checked.
const CHECK_INTERVAL_MS = {
  "daily-20": 30 * 60 * 1000,
  "daily-10": 45 * 60 * 1000,
  "daily-5": 60 * 60 * 1000,
  "daily-3": 1.5 * 60 * 60 * 1000,
  "daily-1": 2 * 60 * 60 * 1000,
  "several-per-week": 6 * 60 * 60 * 1000,
  weekly: 24 * 60 * 60 * 1000,
  monthly: 3 * 24 * 60 * 60 * 1000,
  rare: 7 * 24 * 60 * 60 * 1000,
  unknown: 6 * 60 * 60 * 1000,
};

export function nextCheckDelayMs(groupKey) {
  return CHECK_INTERVAL_MS[groupKey] ?? CHECK_INTERVAL_MS.unknown;
}

// Frequency groups slow enough that missing today's check costs nothing —
// their own CHECK_INTERVAL_MS is already 1-7 days, so gating them to one
// fixed weekday still checks them at least as often as their own schedule
// implies. Daily/several-per-week feeds are excluded: those are exactly the
// ones a reader actually wants checked every day.
const WEEKDAY_THINNED_GROUPS = new Set(["weekly", "monthly", "rare", UNKNOWN_GROUP.key]);

// Deterministic per-feed weekday (0=Sun..6=Sat). Derived purely from feedId
// so it's stable across devices/sessions with nothing to sync or store.
function assignedWeekday(feedId) {
  let hash = 0;
  for (let i = 0; i < feedId.length; i++) {
    hash = (hash * 31 + feedId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 7;
}

// Whether a feed is allowed to actually fetch today, on top of its own
// nextCheckAt schedule. Low-frequency feeds (see WEEKDAY_THINNED_GROUPS)
// only get checked on their one assigned weekday, so a large subscription
// list of rarely-updated feeds doesn't compete for fetch time on every
// single visit — a feed whose nextCheckAt is overdue but whose day hasn't
// come yet just waits, unchanged, until it does.
export function isCheckDayForFeed(feed, now = new Date()) {
  const group = feed.frequencyGroup || UNKNOWN_GROUP.key;
  if (!WEEKDAY_THINNED_GROUPS.has(group)) return true;
  return now.getDay() === assignedWeekday(feed.feedId);
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
