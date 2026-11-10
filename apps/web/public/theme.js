// The theme before the page's code arrives: the saved preference, else the system's. A file for
// the start screen (`welcome.html`), whose policy runs no script written in the page;
// `index.html` has the same in its head, and `src/state/theme.ts` follows it from there.
(() => {
  const saved = localStorage.getItem("ultrapaint:theme");
  const dark =
    saved === "dark" ||
    (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
