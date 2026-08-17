import { putFeed, putEntries, getEntriesByFeed } from "./db.js";
import { getSession } from "./session.js";
import { computeFrequencyGroup, nextCheckDelayMs } from "./frequency.js";

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function text(el) {
  return el ? el.textContent.trim() : "";
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function firstNonEmpty(...values) {
  return values.find((v) => v) || "";
}

// Feeds with no publish dates on their entries can't use the readUntil
// watermark at all — there's nothing to compare against "now". Fall back to
// fingerprinting the entry list itself: if the fingerprint changes, the feed
// has new/changed content and is shown as unread as a whole (see isUnread in
// main.js), since there's no per-entry date to say exactly which is new.
async function hashEntryList(entries) {
  const key = entries.map((e) => e.guid).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseRss(doc, channel) {
  const title = text(channel.querySelector(":scope > title"));
  const items = Array.from(doc.querySelectorAll("item"));
  const entries = items.map((item) => {
    const guid = firstNonEmpty(text(item.querySelector("guid")), text(item.querySelector("link")));
    const content =
      text(item.getElementsByTagNameNS("*", "encoded")[0]) || text(item.querySelector("description"));
    return {
      guid: guid || crypto.randomUUID(),
      title: text(item.querySelector("title")),
      link: text(item.querySelector("link")),
      pubDate: parseDate(text(item.querySelector("pubDate"))),
      summary: text(item.querySelector("description")),
      content,
      author: firstNonEmpty(text(item.querySelector("author")), text(item.getElementsByTagNameNS("*", "creator")[0])),
    };
  });
  return { title, entries };
}

function parseAtom(feedEl) {
  const title = text(feedEl.querySelector(":scope > title"));
  const entryEls = Array.from(feedEl.querySelectorAll("entry"));
  const entries = entryEls.map((entry) => {
    const linkEl =
      entry.querySelector('link[rel="alternate"]') || entry.querySelector("link");
    return {
      guid: firstNonEmpty(text(entry.querySelector("id")), linkEl ? linkEl.getAttribute("href") : ""),
      title: text(entry.querySelector("title")),
      link: linkEl ? linkEl.getAttribute("href") : "",
      pubDate: parseDate(firstNonEmpty(text(entry.querySelector("published")), text(entry.querySelector("updated")))),
      summary: text(entry.querySelector("summary")),
      content: firstNonEmpty(text(entry.querySelector("content")), text(entry.querySelector("summary"))),
      author: text(entry.querySelector("author > name")),
    };
  });
  return { title, entries };
}

function parseFeedXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("failed to parse feed XML");

  const channel = doc.querySelector("rss > channel, channel");
  if (channel) return parseRss(doc, channel);

  const feedEl = doc.querySelector("feed");
  if (feedEl) return parseAtom(feedEl);

  throw new Error("unrecognized feed format");
}

export async function fetchFeed(feed) {
  const { accountId } = getSession();
  const headers = { Authorization: `Bearer ${accountId}` };
  headers["X-Feed-Url"] = feed.url;
  if (feed.etag) headers["X-Feed-If-None-Match"] = feed.etag;
  if (feed.lastModified) headers["X-Feed-If-Modified-Since"] = feed.lastModified;

  const res = await fetch(apiUrl("/api/fetch-feed"), { headers });

  if (res.status === 304) {
    const nextCheckAt = await computeNextCheckAt(feed.feedId);
    await putFeed({ ...feed, lastFetchedAt: new Date().toISOString(), nextCheckAt });
    return [];
  }
  if (!res.ok) {
    throw new Error(`fetch-feed failed: ${res.status}`);
  }

  const xmlText = await res.text();
  const { title, entries } = parseFeedXml(xmlText);

  const dbEntries = entries
    .filter((e) => e.guid)
    .map((e) => ({ id: `${feed.feedId}:${e.guid}`, feedId: feed.feedId, ...e }));
  await putEntries(dbEntries);

  const isDateless = dbEntries.length > 0 && !dbEntries.some((e) => e.pubDate);
  const latestContentHash = isDateless ? await hashEntryList(dbEntries) : null;
  const nextCheckAt = await computeNextCheckAt(feed.feedId);

  await putFeed({
    ...feed,
    title: feed.title || title,
    lastFetchedAt: new Date().toISOString(),
    etag: res.headers.get("ETag") || null,
    lastModified: res.headers.get("Last-Modified") || null,
    latestContentHash,
    nextCheckAt,
  });

  return dbEntries;
}

// Schedules the next fetch based on the feed's own posting frequency
// (computed from its full cached history, same as the UI's grouping) so a
// large subscription list doesn't mean re-fetching everything on every
// visit. Purely local — never synced to the server.
async function computeNextCheckAt(feedId) {
  const allEntries = await getEntriesByFeed(feedId);
  const group = computeFrequencyGroup(allEntries);
  return new Date(Date.now() + nextCheckDelayMs(group.key)).toISOString();
}
