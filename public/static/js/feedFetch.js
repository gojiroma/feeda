import { putFeed, putEntries } from "./db.js";
import { getSession } from "./session.js";
import { getActiveUrlBlockPatterns, matchesAnyUrlBlockPattern } from "./urlBlocks.js";

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

// Dublin Core's dc:date, used for the publish date instead of RSS 2.0's
// <pubDate> by RSS 1.0/RDF feeds (e.g. Hatena Bookmark's user feeds).
// Matched by local name only so it works regardless of which prefix the
// feed bound the Dublin Core namespace to.
function dcDate(el) {
  return text(el.getElementsByTagNameNS("*", "date")[0]);
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
      pubDate: parseDate(firstNonEmpty(text(item.querySelector("pubDate")), dcDate(item))),
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
      pubDate: parseDate(firstNonEmpty(text(entry.querySelector("published")), text(entry.querySelector("updated")), dcDate(entry))),
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

// Fetches one feed on demand (see main.js's selectFeed — there's no
// background crawl any more, this only ever runs when the user actually
// clicks the feed in the sidebar) and stores whatever new entries it finds.
// etag/lastModified still ride along on a conditional GET so re-clicking an
// unchanged feed costs a cheap 304 instead of a full re-download.
export async function fetchFeed(feed) {
  const { accountId } = getSession();
  const headers = { Authorization: `Bearer ${accountId}` };
  headers["X-Feed-Url"] = feed.url;
  if (feed.etag) headers["X-Feed-If-None-Match"] = feed.etag;
  if (feed.lastModified) headers["X-Feed-If-Modified-Since"] = feed.lastModified;

  const res = await fetch(apiUrl("/api/fetch-feed"), { headers });

  if (res.status === 304) {
    await putFeed({ ...feed, lastFetchedAt: new Date().toISOString() });
    return [];
  }
  if (!res.ok) {
    // Read whatever body came back (our backend's JSON {error: "..."} when
    // it failed cleanly, or the platform's own plain-text/HTML page when
    // the function was killed before our code could respond) so the reason
    // actually shows up in the console instead of just a bare status code.
    const detail = await res.text().catch(() => "");
    throw new Error(`fetch-feed failed: ${res.status}${detail ? ` - ${detail.slice(0, 300)}` : ""}`);
  }

  const xmlText = await res.text();
  const { title, entries } = parseFeedXml(xmlText);

  // "刈り取り" (reap) blocklist (see urlBlocks.js) — an entry whose link
  // matches one of these wildcard patterns is rejected right here, before it
  // ever reaches IndexedDB, rather than merely hidden at render time.
  const blockPatterns = (await getActiveUrlBlockPatterns()).map((p) => p.pattern);
  const dbEntries = entries
    .filter((e) => e.guid && !matchesAnyUrlBlockPattern(e.link, blockPatterns))
    .map((e) => ({ id: `${feed.feedId}:${e.guid}`, feedId: feed.feedId, ...e }));
  await putEntries(dbEntries);

  await putFeed({
    ...feed,
    // The feed's own <title> is the source of truth for what to call it —
    // prefer it over whatever guess was stored at registration time (e.g.
    // the userscript's best-effort <link title> guess, or an OPML entry's
    // title). This also self-heals feeds that were registered with a wrong
    // guess: the next time each one is fetched, its real title takes over.
    // Only fall back to the stored guess for the rare feed that omits
    // <title> entirely.
    title: title || feed.title,
    lastFetchedAt: new Date().toISOString(),
    etag: res.headers.get("ETag") || null,
    lastModified: res.headers.get("Last-Modified") || null,
  });

  return dbEntries;
}
