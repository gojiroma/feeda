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

// Read status a feed falls into for the sidebar's outer tree level — see
// groupFeedsByFrequency below. Independent of posting frequency: a feed
// keeps its status bucket regardless of how often it posts, and gets a
// frequency breakdown *within* that bucket instead of frequency deciding
// the bucket itself (which is how paused/no-unread feeds used to lose their
// frequency info entirely).
const STATUS_GROUPS = [
  { key: "unread", label: "未読" },
  { key: "read", label: "既読" },
  { key: "stale", label: "更新なし" },
  { key: "paused", label: "更新停止" },
];

// A feed whose newest known content is older than this sits in "更新なし"
// regardless of read state — distinct from "更新停止" (paused), which is a
// deliberate user choice that also stops the feed from being fetched at all.
// A stale feed keeps being fetched on its normal schedule (see refreshAll in
// main.js), it just stops cluttering 未読/既読 while it has nothing new to
// say.
const STALE_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000;

// Most-frequent-first, so an initial scan (or one on a fresh device that
// has no local fetch history yet but did pull synced frequencyGroup values
// from other devices — see feed.frequencyGroup) fetches daily feeds before
// rarely-updated ones. Also the basis for MOBILE_FREQUENCY_ORDER (main.js),
// which reverses it.
export const FREQUENCY_ORDER = [...GROUPS.map((g) => g.key), UNKNOWN_GROUP.key, "paused"];

// Within a status bucket's frequency sub-tree, least-frequent first —
// putting the most-frequent feeds up front makes it too easy to only ever
// check the same handful of very active feeds and let the less-frequent
// ones go unnoticed, so this is the reverse of GROUPS (which is ordered
// most-frequent-first for the maxAvgDays lookup in computeFrequencyGroup).
// "頻度不明" sits with the low-frequency end, between "それ以下" and the
// daily tiers, since a feed with no posting history yet is closer to "no
// signal" than to "posts often". Fetch priority (FREQUENCY_ORDER above) is
// unaffected by this — it still fetches daily feeds first.
const FREQUENCY_SUBGROUP_ORDER = [
  ...GROUPS.filter((g) => !g.key.startsWith("daily-"))
    .map((g) => g.key)
    .reverse(),
  UNKNOWN_GROUP.key,
  ...GROUPS.filter((g) => g.key.startsWith("daily-"))
    .map((g) => g.key)
    .reverse(),
];

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

function datedTimestamps(entries) {
  return entries
    .map((e) => e.pubDate)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
}

// Feeds with dated entries sort by their newest entry's date, newest first.
// Date-less feeds have no publish date to go by, so they sort by when they
// were last fetched instead — a freshly-fetched date-less feed (which just
// had its content-hash checked and possibly changed) rises to the top.
function feedSortTimestamp(feed, entries) {
  const dated = datedTimestamps(entries);
  if (dated.length > 0) return Math.max(...dated);
  return feed.lastFetchedAt ? new Date(feed.lastFetchedAt).getTime() : 0;
}

// Null when there's no signal at all yet — a just-registered feed that
// hasn't been fetched once has neither dated entries nor a lastFetchedAt.
// That must read as "unknown", not "stale": falling back to 0 like
// feedSortTimestamp does would make every brand-new feed look like it's
// been silent for decades and dump it straight into 更新なし.
function lastUpdateTimestamp(feed, entries) {
  const dated = datedTimestamps(entries);
  if (dated.length > 0) return Math.max(...dated);
  return feed.lastFetchedAt ? new Date(feed.lastFetchedAt).getTime() : null;
}

function feedStatusGroup(feed, entries) {
  if (feed.paused) return STATUS_GROUPS.find((g) => g.key === "paused");
  const lastUpdate = lastUpdateTimestamp(feed, entries);
  if (lastUpdate !== null && Date.now() - lastUpdate > STALE_THRESHOLD_MS) {
    return STATUS_GROUPS.find((g) => g.key === "stale");
  }
  return feed.hasUnread ? STATUS_GROUPS.find((g) => g.key === "unread") : STATUS_GROUPS.find((g) => g.key === "read");
}

// A pinned feed (see main.js's togglePinFeed) gets pulled out of the normal
// status/frequency tree entirely and shown as its own flat group at the very
// top of the sidebar, regardless of read state, staleness, or pause — "pin
// this to the top" would be a weak promise if a pinned-but-paused feed still
// only showed up buried under 更新停止. group.key deliberately matches
// status.key: it signals to feedList.js that this status has exactly one,
// synthetic subgroup and doesn't need the usual nested frequency <details>.
const PINNED_STATUS = { key: "pinned", label: "📌 ピン留め" };
const PINNED_GROUP = { key: "pinned", label: "ピン留め" };

// Primary sort within every group (and the pinned list): engagement score
// first — a feed you've actually clicked into, commented on, or
// color-tagged outranks one that's merely posted recently but gone
// unengaged (see feed.engagementScore, attached in main.js's
// currentFeedGroups from logbook.js's getFeedEngagementScores) — falling
// back to newest-content recency only to break ties between equally
// (un)engaged feeds.
function compareFeeds(a, b) {
  return b.score - a.score || b.sortTimestamp - a.sortTimestamp;
}

function feedEntry(feed, entries) {
  return { feed, sortTimestamp: feedSortTimestamp(feed, entries), score: feed.engagementScore || 0 };
}

// Builds the sidebar's two-level tree: outer groups by read status (未読 /
// 既読 / 更新なし / 更新停止), each holding its own posting-frequency
// breakdown — so e.g. a paused feed that used to post daily still shows up
// under "1日1回" within "更新停止", instead of losing that information the
// moment it's paused. Same for a feed that's simply gone quiet for over a
// year: it moves to "更新なし" but keeps its frequency history. Pinned feeds
// (see PINNED_STATUS above) skip this whole tree and come back as their own
// group, prepended ahead of everything else.
export function groupFeedsByFrequency(feedsWithEntries) {
  const pinned = [];
  const statusBuckets = new Map(); // statusKey -> Map(freqKey -> {group, feeds})

  for (const { feed, entries } of feedsWithEntries) {
    if (feed.pinned) {
      pinned.push(feedEntry(feed, entries));
      continue;
    }
    const status = feedStatusGroup(feed, entries);
    const freqGroup = computeFrequencyGroup(entries);
    if (!statusBuckets.has(status.key)) statusBuckets.set(status.key, new Map());
    const freqMap = statusBuckets.get(status.key);
    if (!freqMap.has(freqGroup.key)) freqMap.set(freqGroup.key, { group: freqGroup, feeds: [] });
    freqMap.get(freqGroup.key).feeds.push(feedEntry(feed, entries));
  }

  for (const freqMap of statusBuckets.values()) {
    for (const { feeds } of freqMap.values()) {
      feeds.sort(compareFeeds);
    }
  }
  pinned.sort(compareFeeds);

  const groups = STATUS_GROUPS.filter((s) => statusBuckets.has(s.key)).map((status) => {
    const freqMap = statusBuckets.get(status.key);
    const subgroups = FREQUENCY_SUBGROUP_ORDER.filter((key) => freqMap.has(key)).map((key) => {
      const { group, feeds } = freqMap.get(key);
      return { group, feeds: feeds.map((f) => f.feed) };
    });
    return { status, subgroups };
  });

  if (pinned.length === 0) return groups;
  return [{ status: PINNED_STATUS, subgroups: [{ group: PINNED_GROUP, feeds: pinned.map((f) => f.feed) }] }, ...groups];
}
