const SVG_NS = "http://www.w3.org/2000/svg";
const TARGETS = "[data-gravity], h1, h2, p, button, a";
const MAX_TARGETS = 64;

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function measureTargets() {
  const targets: { element: HTMLElement; box: DOMRect }[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(TARGETS)) {
    if (
      element.closest(
        "[data-gravity-source], [data-nextjs-dialog], [role=dialog]"
      ) ||
      element.parentElement?.closest(TARGETS)
    ) {
      continue;
    }
    const box = element.getBoundingClientRect();
    if (
      !(box.width && box.height) ||
      box.bottom < 0 ||
      box.top > window.innerHeight
    ) {
      continue;
    }
    targets.push({ box, element });
    if (targets.length === MAX_TARGETS) {
      break;
    }
  }
  return targets;
}

/** Filters SourceGraphic itself: letters and panel edges bend locally without moving their DOM boxes. */
export function createGravityLens(
  width: number,
  height: number,
  displacement: number
) {
  const definitions = svgElement("svg", {
    "aria-hidden": "true",
    "data-gravity-lens": "",
    height: 0,
    width: 0,
  });
  definitions.style.cssText =
    "position:fixed;pointer-events:none;overflow:hidden";
  const prefix = `gravity-${crypto.randomUUID()}`;
  const targets = measureTargets();
  const stars = document.getElementById("montage-stars");
  // Filter a wrapper in CSS pixels so the star SVG's cropped viewBox shares the UI's coordinate system.
  const starSurface = stars?.closest<HTMLElement>("[data-gravity-sky]");
  if (starSurface) {
    targets.push({
      box: starSurface.getBoundingClientRect(),
      element: starSurface,
    });
  }
  const filters = targets.map(({ element, box }, index) => {
    const id = `${prefix}-${index}`;
    const margin = displacement + 4;
    const filter = svgElement("filter", {
      "color-interpolation-filters": "sRGB",
      filterUnits: "userSpaceOnUse",
      height: element.offsetHeight + margin * 2,
      id,
      primitiveUnits: "userSpaceOnUse",
      width: element.offsetWidth + margin * 2,
      x: -margin,
      y: -margin,
    });
    const image = svgElement("feImage", {
      height,
      preserveAspectRatio: "none",
      result: "field",
      width,
      x: -box.left,
      y: -box.top,
    });
    // PNG's neutral byte is 128, not 127.5. Correct it to avoid shifting untouched pixels.
    const neutral = svgElement("feComponentTransfer", {
      in: "field",
      result: "centered",
    });
    for (const channel of ["feFuncR", "feFuncG"] as const) {
      neutral.append(
        svgElement(channel, { intercept: -0.5 / 255, slope: 1, type: "linear" })
      );
    }
    const bend = svgElement("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "centered",
      scale: displacement * 2,
      xChannelSelector: "R",
      yChannelSelector: "G",
    });
    filter.append(image, neutral, bend);
    definitions.append(filter);
    const original = element.style.filter;
    const computed = getComputedStyle(element).filter;
    const applied = `${computed === "none" ? "" : `${computed} `}url("#${id}")`;
    return { applied, element, image, original };
  });
  document.body.append(definitions);
  let ready = false;
  let pending = false;
  let disposed = false;
  // Decode first so swapping an feImage never briefly blanks its SourceGraphic while the new PNG loads.
  const decoded = new Image();
  decoded.onload = () => {
    pending = false;
    if (disposed) {
      return;
    }
    const boxes = filters.map(({ element }) => element.getBoundingClientRect());
    for (const [index, { element, image, applied }] of filters.entries()) {
      const box = boxes[index];
      if (!box) {
        continue;
      }
      const scaleX = box.width / (element.offsetWidth || box.width);
      const scaleY = box.height / (element.offsetHeight || box.height);
      image.setAttribute("x", String(-box.left / scaleX));
      image.setAttribute("y", String(-box.top / scaleY));
      image.setAttribute("width", String(width / scaleX));
      image.setAttribute("height", String(height / scaleY));
      image.setAttribute("href", decoded.src);
      if (!ready) {
        element.style.filter = applied;
      }
    }
    ready = true;
  };
  decoded.onerror = () => {
    pending = false;
  };
  return {
    dispose() {
      disposed = true;
      decoded.onload = null;
      decoded.onerror = null;
      for (const { element, original } of filters) {
        element.style.filter = original;
      }
      definitions.remove();
    },
    update(texture: string) {
      if (pending || disposed) {
        return;
      }
      pending = true;
      decoded.src = texture;
    },
  };
}
