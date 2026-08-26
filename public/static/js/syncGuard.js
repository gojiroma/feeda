// sync.js/logSync.js/ngWordSync.js/searchSync.js's own top-level "syncNow"
// functions are called fire-and-forget from many places in main.js (every
// pause/pin/color/tag action, periodic timers, etc. — see main.js's many
// `syncNow().catch(...)` call sites) with nothing stopping two calls from
// running concurrently. Two overlapping push cycles both snapshot the same
// dirty rows independently and race to write them back, which compounds the
// stale-snapshot clobber each push already guards against on its own (see
// e.g. sync.js's pushDirtyFeeds) and can double up outbound requests.
//
// serialized() wraps a zero-argument async function so it never runs two
// invocations at once: a call that arrives while one is already in flight
// doesn't start a second one, it just waits on the in-flight run and then
// (once) triggers exactly one more run after that, so anything that became
// dirty *during* the in-flight run still gets picked up promptly rather
// than waiting for some unrelated future trigger.
export function serialized(fn) {
  let inFlight = null;
  let rerunRequested = false;

  async function runOnce() {
    try {
      await fn();
    } finally {
      inFlight = null;
      if (rerunRequested) {
        rerunRequested = false;
        start();
      }
    }
  }

  function start() {
    inFlight = runOnce();
    return inFlight;
  }

  return function serializedCall() {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }
    return start();
  };
}
