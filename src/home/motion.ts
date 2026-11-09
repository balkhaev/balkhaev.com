/**
 * Homepage motion beyond CSS: a live Moscow clock in the top bar, sections
 * below the fold that assemble when they scroll into view, and the black
 * hole's pull on the letters of the name as the pointer comes near it.
 */

const CLOCK = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Moscow",
});

/** Pull of a letter at `gap` pixels from the hole whose diameter is `size`. */
export function pullAt(gap: number, size: number, strength: number) {
  const reach = size * 0.9;
  return strength * size * 0.22 * (reach / (reach + Math.max(0, gap))) ** 2;
}

/** 0 far away, 1 on the hole: how close the pointer is, eased. */
export function nearness(distance: number, size: number) {
  const range = size * 2.6;
  const t = Math.max(0, Math.min(1, 1 - distance / range));
  return t * t * (3 - 2 * t);
}

function startClock() {
  const clock = document.querySelector<HTMLTimeElement>("[data-clock]");
  if (!clock) {
    return;
  }
  const tick = () => {
    clock.textContent = CLOCK.format(new Date());
  };
  tick();
  clock.hidden = false;
  setInterval(tick, 1000);
}

function startReveal(still: boolean) {
  const waiting = [
    ...document.querySelectorAll<HTMLElement>(".contacts, .site-foot"),
  ].filter((element) => element.getBoundingClientRect().top > innerHeight);
  if (still || !waiting.length || !("IntersectionObserver" in window)) {
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.remove("reveal-wait");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.01 }
  );
  for (const element of waiting) {
    element.classList.add("reveal-wait");
    observer.observe(element);
  }
}

function startGravity() {
  const glyphs = [...document.querySelectorAll<HTMLElement>(".glyph")];
  const anchor = document.getElementById("hole-anchor");
  const name = glyphs[0]?.parentElement;
  if (!(anchor && name && glyphs.length)) {
    return;
  }
  // Rest positions from layout, which ignores transforms.
  let rest: { x: number; y: number; w: number }[] = [];
  let hole = { size: 0, x: 0, y: 0 };
  const measure = () => {
    rest = glyphs.map((glyph) => ({
      w: glyph.offsetWidth,
      x: glyph.offsetLeft + glyph.offsetWidth / 2,
      y: glyph.offsetTop + glyph.offsetHeight * 0.55,
    }));
    const box = name.getBoundingClientRect();
    const spot = anchor.getBoundingClientRect();
    const size = anchor.offsetWidth;
    hole = {
      size,
      // Relative to the name's box, the same frame as offsetLeft.
      x: spot.left + spot.width / 2 - box.left + name.offsetLeft,
      y: spot.top + spot.height / 2 - box.top + name.offsetTop,
    };
  };
  let target = 0;
  let current = 0;
  let frame = 0;
  const draw = () => {
    frame = 0;
    current += (target - current) * 0.09;
    if (Math.abs(target - current) < 0.002) {
      current = target;
    }
    for (const [i, glyph] of glyphs.entries()) {
      const at = rest[i];
      if (!at) {
        continue;
      }
      const gap = hole.x - hole.size / 2 - (at.x + at.w / 2);
      const pull = pullAt(gap, hole.size, current);
      const rise = ((hole.y - at.y) / hole.size) * pull * 0.35;
      glyph.style.setProperty("--pull-x", `${pull.toFixed(2)}px`);
      glyph.style.setProperty("--pull-y", `${rise.toFixed(2)}px`);
      glyph.style.setProperty(
        "--pull-r",
        `${((pull / hole.size) * 14).toFixed(3)}deg`
      );
      glyph.style.setProperty(
        "--pull-s",
        (1 + (pull / Math.max(1, at.w)) * 0.5).toFixed(4)
      );
    }
    if (current !== target) {
      frame = requestAnimationFrame(draw);
    }
  };
  const aim = (next: number) => {
    target = next;
    if (!frame && target !== current) {
      frame = requestAnimationFrame(draw);
    }
  };
  measure();
  window.addEventListener("resize", measure, { passive: true });
  document.fonts?.ready.then(measure).catch(() => undefined);
  // The pull starts once the letters have landed.
  setTimeout(() => {
    measure();
    for (const glyph of glyphs) {
      glyph.classList.add("glyph-pulled");
    }
  }, 1700);
  window.addEventListener(
    "pointermove",
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        return;
      }
      const root = document.documentElement.classList;
      if (root.contains("scene-expanded") || root.contains("scene-diving")) {
        aim(0);
        return;
      }
      const spot = anchor.getBoundingClientRect();
      const distance = Math.hypot(
        event.clientX - (spot.left + spot.width / 2),
        event.clientY - (spot.top + spot.height / 2)
      );
      aim(nearness(distance, spot.width));
    },
    { passive: true }
  );
  document.addEventListener("pointerleave", () => aim(0));
}

export function startHomeMotion() {
  if (!document.querySelector(".masthead")) {
    return;
  }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  startClock();
  startReveal(still);
  if (!still && matchMedia("(pointer: fine)").matches) {
    startGravity();
  }
}
