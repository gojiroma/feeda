// Frequency groups, most-frequent-first. The "daily" range (avgDays <= 1.5,
// i.e. roughly one post per day or more often) is split into five posts-
// per-day tiers instead of one lump "毎日" bucket, since a feed that posts
// 20 times a day and one that posts once a day both used to land in the
// same group. Each tier's maxAvgDays is 1 / (that tier's posts-per-day),
// except the bottom tier (daily-1) which keeps the original 1.5-day cutoff
// so the boundary against "several-per-week" doesn't move.
//
// Purely a display grouping for the feed list now (see ui/feedList.js) —
// there's no background crawl any more (feeds are only ever fetched on
// click, see feedFetch.js/main.js's selectFeed), so this no longer feeds
// any fetch-scheduling decision the way it used to.
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

// Most-frequent-first — the order the feed list's frequency sections are
// shown in (see ui/feedList.js).
export const FREQUENCY_ORDER = [...GROUPS.map((g) => g.key), UNKNOWN_GROUP.key];

export const FREQUENCY_LABELS = new Map([...GROUPS, UNKNOWN_GROUP].map((g) => [g.key, g.label]));

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
