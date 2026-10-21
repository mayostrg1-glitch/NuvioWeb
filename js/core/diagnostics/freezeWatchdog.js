// Main-thread freeze reporter, only active with ?debug=1 in the URL.
//
// A frozen page cannot report itself, so a worker watches a heartbeat from the
// main thread and fires a beacon once it stops for FREEZE_MS. When the thread
// comes back, the long-animation-frame entries say which script held it. Both
// land in the Caddy access log as /__dbg_nav requests, like the router tracer.

const HEARTBEAT_MS = 500;
const FREEZE_MS = 3000;
const SLOW_FRAME_MS = 1000;

function debugEnabled() {
  const flag = new URLSearchParams(globalThis.location?.search || "").get("debug");
  return flag !== null && flag !== "0" && flag !== "false";
}

function beaconUrl(route, step, extra) {
  const query = new URLSearchParams({
    v: "1",
    r: route,
    s: step,
    e: String(extra).slice(0, 400),
    t: String(Date.now())
  });
  return `${globalThis.location.origin}/__dbg_nav?${query}`;
}

// The worker only sees what the last heartbeat told it, so the heartbeat
// carries the context a freeze report needs.
function snapshot(getRoute) {
  const screen = document.getElementById(getRoute());
  const scroller = (screen ? [screen, ...screen.querySelectorAll("*")] : []).reduce(
    (best, node) => (node.scrollTop > (best?.scrollTop || 0) ? node : best),
    null
  );
  return [
    `route=${getRoute()}`,
    `nodes=${document.getElementsByTagName("*").length}`,
    `scroll=${scroller ? `${scroller.id || scroller.className}`.slice(0, 40) + ":" + Math.round(scroller.scrollTop) : 0}`,
    `vw=${globalThis.innerWidth}x${globalThis.innerHeight}`,
    `hidden=${document.hidden}`
  ].join(" ");
}

const WORKER_SOURCE = `
let last = Date.now(), context = "", reported = false;
onmessage = (event) => {
  if (reported) fetch(event.data.recoveredUrl, { keepalive: true, credentials: "omit" }).catch(() => {});
  last = Date.now(); context = event.data; reported = false;
};
setInterval(() => {
  const stalled = Date.now() - last;
  if (reported || !context || stalled < ${FREEZE_MS}) return;
  reported = true;
  fetch(context.freezeUrl + "&stalled=" + stalled, { keepalive: true, credentials: "omit" }).catch(() => {});
}, 500);
`;

export function installFreezeWatchdog({ getRoute = () => "" } = {}) {
  if (!debugEnabled() || typeof Worker !== "function" || typeof Blob !== "function") return;
  let worker;
  try {
    worker = new Worker(
      URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }))
    );
  } catch {
    return;
  }
  let lastBeat = Date.now();
  setInterval(() => {
    const now = Date.now();
    const context = snapshot(getRoute);
    worker.postMessage({
      freezeUrl: beaconUrl(getRoute(), "freeze", context),
      recoveredUrl: beaconUrl(getRoute(), "recovered", `gap=${now - lastBeat} ${context}`)
    });
    lastBeat = now;
  }, HEARTBEAT_MS);

  try {
    new PerformanceObserver((list) => {
      for (const frame of list.getEntries()) {
        if (frame.duration < SLOW_FRAME_MS) continue;
        const scripts = [...(frame.scripts || [])]
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map(
            (script) =>
              `${Math.round(script.duration)}ms ${script.invokerType}:${script.invoker} fn=${script.sourceFunctionName || "?"}@${String(
                script.sourceURL || ""
              )
                .split("/")
                .pop()}:${script.sourceCharPosition}`
          );
        new Image().src = beaconUrl(
          getRoute(),
          "slow-frame",
          `${Math.round(frame.duration)}ms block=${Math.round(frame.blockingDuration || 0)} ${scripts.join(" | ") || "no-script"} ${snapshot(getRoute)}`
        );
      }
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch {}
}
