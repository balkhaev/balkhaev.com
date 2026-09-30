export interface GravitySource {
  radius: number;
  x: number;
  y: number;
}

/** Inverse sampling offsets: a moving logarithmic field carries light inward, with stronger shear near the hole. */
export function infallField(
  x: number,
  y: number,
  source: GravitySource,
  time: number
) {
  const vx = x - source.x;
  const vy = y - source.y;
  const distance = Math.hypot(vx, vy);
  if (distance < 1) {
    return { x: 0, y: 0 };
  }
  const radius = Math.max(1, source.radius);
  const proximity = 1 / (1 + (distance / (radius * 2.8)) ** 2);
  const phase = Math.log1p(distance / radius) * 9 + time * 1.8;
  const radial = (6 + 24 * proximity) * (0.72 + Math.sin(phase) * 0.28);
  const twist = (2 + 12 * proximity) * Math.sin(phase * 0.7 + 0.8);
  return {
    x: (vx * radial - vy * twist) / distance,
    y: (vy * radial + vx * twist) / distance,
  };
}

/** A continuous family of images approaches the horizon asymptotically; images fade before their phase wraps. */
export function infallImage(
  progress: number,
  distance: number,
  radius: number
) {
  const approach = Math.exp(-progress * progress * 4.2);
  return {
    distance:
      Math.min(distance, radius * 0.84) +
      Math.max(0, distance - radius * 0.84) * approach,
    opacity: Math.sin(Math.PI * progress) ** 2 * 0.48,
    scale: 0.12 + Math.sqrt(approach) * 0.88,
    stretch: 1 + Math.sin(Math.PI * progress) * 1.8,
    turn: progress * progress * 1.4,
  };
}

/** Only decorative light images are cloned; the original anchors remain the sole interactive and accessible links. */
export function createInfallImages() {
  const surface = document.createElement("div");
  surface.className = "infall-images";
  surface.dataset.gravityInfall = "";
  surface.setAttribute("aria-hidden", "true");
  surface.inert = true;
  const targets = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".contacts a")
  );
  const images = targets.map((target) => {
    const style = getComputedStyle(target);
    const copies = Array.from({ length: 3 }, () => {
      const copy = document.createElement("div");
      copy.className = "infall-copy";
      copy.textContent = target.textContent;
      copy.style.font = style.font;
      copy.style.letterSpacing = style.letterSpacing;
      surface.append(copy);
      return copy;
    });
    return { copies, target };
  });
  document.querySelector("main")?.prepend(surface);
  return {
    dispose: () => surface.remove(),
    update(source: GravitySource, time: number, low: boolean) {
      const boxes = images.map(({ target }) => target.getBoundingClientRect());
      for (const [index, { copies }] of images.entries()) {
        const box = boxes[index];
        if (!box) {
          continue;
        }
        const dx = box.left + box.width / 2 - source.x;
        const dy = box.top + box.height / 2 - source.y;
        const distance = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        for (const [i, copy] of copies.entries()) {
          if (low && i === 2) {
            copy.style.opacity = "0";
            continue;
          }
          const count = low ? 2 : 3;
          const progress = (time / 9 + i / count + index * 0.17) % 1;
          const image = infallImage(progress, distance, source.radius);
          const turn = angle + image.turn;
          const x = source.x + Math.cos(turn) * image.distance;
          const y = source.y + Math.sin(turn) * image.distance;
          // Stretch in the radial direction, then rotate back: the letters themselves undergo tidal shear.
          copy.style.transform = `translate(${x}px, ${y}px) rotate(${turn}rad) scale(${image.scale * image.stretch}, ${image.scale / image.stretch}) rotate(${-angle}rad) translate(-50%, -50%)`;
          copy.style.opacity = String(image.opacity);
        }
      }
      return boxes;
    },
  };
}
