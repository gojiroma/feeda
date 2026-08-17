const GROUPS = [
  { key: "daily", label: "毎日", maxAvgDays: 1.5 },
  { key: "several-per-week", label: "週数回", maxAvgDays: 4 },
  { key: "weekly", label: "週1回程度", maxAvgDays: 9 },
  { key: "monthly", label: "月1回程度", maxAvgDays: 45 },
  { key: "rare", label: "それ以下", maxAvgDays: Infinity },
];
const UNKNOWN_GROUP = { key: "unknown", label: "頻度不明" };
const SAMPLE_SIZE = 20;

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

export function groupFeedsByFrequency(feedsWithEntries) {
  const groups = new Map();
  for (const { feed, entries } of feedsWithEntries) {
    const group = computeFrequencyGroup(entries);
    if (!groups.has(group.key)) groups.set(group.key, { group, feeds: [] });
    groups.get(group.key).feeds.push(feed);
  }
  const order = [...GROUPS, UNKNOWN_GROUP].map((g) => g.key);
  return order
    .filter((key) => groups.has(key))
    .map((key) => groups.get(key));
}
