const TARGETS = "[data-gravity], h1, h2, p, button, a";
const MAX_TARGETS = 64;
const SETTLE_RATE = 3.5;

/** A bounded attraction: nearby elements lean in, while distant controls remain easy to use. */
export function gravityPullAt(dx: number, dy: number) {
  const distance = Math.hypot(dx, dy);
  const strength = 12 / ((distance + 80) * (1 + (distance / 520) ** 2));
  return { x: dx * strength, y: dy * strength };
}

/** Individual translate keeps hit boxes with their controls and composes with the page's transform animations. */
export function createGravityPull(
  scene: HTMLElement,
  handle: HTMLButtonElement,
  reducedMotion: MediaQueryList
) {
  const targets = Array.from(document.querySelectorAll<HTMLElement>(TARGETS))
    .filter(
      (element) =>
        !(
          element.closest(
            "[data-gravity-source], [data-gravity-infall], [data-nextjs-dialog], [role=dialog], [data-film-transition]"
          ) || element.parentElement?.closest(TARGETS)
        ) && getComputedStyle(element).translate === "none"
    )
    .slice(0, MAX_TARGETS)
    .map((element) => ({
      element,
      original: element.style.translate,
      x: 0,
      y: 0,
    }));
  let frame = 0;
  let last = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };
  const restore = () => {
    stop();
    for (const target of targets) {
      target.element.style.translate = target.original;
      target.x = 0;
      target.y = 0;
    }
  };
  const tick = (now: number) => {
    frame = 0;
    if (reducedMotion.matches) {
      restore();
      return;
    }
    // Freeze during the film transition so its measured collapse paths stay stable.
    if (document.hidden || handle.disabled) {
      stop();
      return;
    }
    const seconds = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const ease = 1 - Math.exp(-SETTLE_RATE * seconds);
    const source = scene.getBoundingClientRect();
    const x = source.left + source.width / 2;
    const y = source.top + source.height / 2;
    // Batch layout reads before writes; subtract our own offset to avoid feedback drift.
    const forces = targets.map((target) => {
      const box = target.element.getBoundingClientRect();
      if (
        !(box.width && box.height) ||
        source.bottom < 0 ||
        source.top > innerHeight
      ) {
        return { x: 0, y: 0 };
      }
      return gravityPullAt(
        x - (box.left + box.width / 2 - target.x),
        y - (box.top + box.height / 2 - target.y)
      );
    });
    let unsettled = false;
    for (const [index, target] of targets.entries()) {
      const force = forces[index];
      if (!force) {
        continue;
      }
      const delta = Math.hypot(force.x - target.x, force.y - target.y);
      unsettled ||= delta > 0.025;
      target.x += (force.x - target.x) * ease;
      target.y += (force.y - target.y) * ease;
      target.element.style.translate = `${target.x.toFixed(3)}px ${target.y.toFixed(3)}px`;
    }
    if (unsettled) {
      frame = requestAnimationFrame(tick);
    } else {
      last = 0;
    }
  };
  const update = () => {
    if (!frame) {
      frame = requestAnimationFrame(tick);
    }
  };
  const observer = new ResizeObserver(update);
  observer.observe(scene);
  for (const { element } of targets) {
    observer.observe(element);
  }
  const disabled = new MutationObserver(update);
  disabled.observe(handle, { attributeFilter: ["disabled"] });
  window.addEventListener("resize", update);
  document.addEventListener("scroll", update, { capture: true, passive: true });
  document.addEventListener("visibilitychange", update);
  reducedMotion.addEventListener("change", update);
  update();
  return {
    dispose() {
      restore();
      observer.disconnect();
      disabled.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
      document.removeEventListener("visibilitychange", update);
      reducedMotion.removeEventListener("change", update);
    },
    update,
  };
}
