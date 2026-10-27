/**
 * A module whose own top-level code listens to the window and starts an interval, as analytics
 * and polling do: `pnpm e2e:sandbox` edits it, and each version's must go with it.
 */
const seen = window as unknown as {
  __leftovers?: { heard: number; ticks: number };
};
seen.__leftovers ??= { heard: 0, ticks: 0 };
const counts = seen.__leftovers;

window.addEventListener("message", (event) => {
  if (event.data === "leftover-probe") {
    counts.heard += 1;
  }
});
setInterval(() => {
  counts.ticks += 1;
}, 100);

export const VERSION = 1;

export function LeftoverProbe() {
  return (
    <p data-probe="leftovers" style={{ padding: 16 }}>
      leftovers v{VERSION}
    </p>
  );
}
