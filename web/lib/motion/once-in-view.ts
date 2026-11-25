/**
 * The band a part must reach to count as seen (spec 2026-11-23 section 5.1): anything above the viewport counts, so a
 * page opened half way down shows the parts it scrolled past finished, and the bottom 12% of the viewport does not.
 */
export const SEEN_ROOT_MARGIN = "100000px 0px -12% 0px";

let shared: IntersectionObserver | undefined;

/** The page's one observer, made on first use. */
function observer(): IntersectionObserver {
  shared ??= new IntersectionObserver(
    (entries, io) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-seen", "");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: SEEN_ROOT_MARGIN },
  );
  return shared;
}

/**
 * Sets data-seen on `el` the first time it enters the band, through one IntersectionObserver the whole page shares.
 * Where IntersectionObserver is missing (jsdom, old browsers) it sets data-seen at once, so the part shows its final
 * frame. An element already seen is left alone. Returns a cleanup that stops watching `el`.
 */
export function onceInView(el: Element): () => void {
  if (el.hasAttribute("data-seen")) return () => {};
  if (typeof IntersectionObserver === "undefined") {
    el.setAttribute("data-seen", "");
    return () => {};
  }
  const io = observer();
  io.observe(el);
  return () => io.unobserve(el);
}
