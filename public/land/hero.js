const stage = document.querySelector("#atlas-stage");
const range = document.querySelector("#atlas-range");
const controls = document.querySelector("#atlas-buttons");
const buttons = [...controls.querySelectorAll("[data-atlas-view]")];
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let frame;
let used = false;

function render(value) {
  const edge = Math.round(value * 10) / 10;
  stage.style.setProperty("--atlas-edge", `${edge}%`);
  stage.dataset.hideBase = String(edge <= 7);
  stage.dataset.hidePlan = String(edge >= 93);
  stage.dataset.showMarker = String(edge < 69);
}

function apply(value) {
  range.value = String(value);
  render(value);
  const split = Number(range.value);
  range.setAttribute(
    "aria-valuetext",
    `${split}% рельефа, ${100 - split}% генплана`
  );
  for (const button of buttons) {
    const view = Number(button.dataset.atlasView);
    const isSelected = view === 43 ? split > 0 && split < 100 : split === view;
    button.setAttribute("aria-pressed", String(isSelected));
  }
}

function stopIntro() {
  used = true;
  cancelAnimationFrame(frame);
}

range.hidden = false;
controls.hidden = false;
apply(43);
range.addEventListener("input", () => {
  stopIntro();
  apply(Number(range.value));
});
range.addEventListener("pointerdown", stopIntro);
range.addEventListener("keydown", stopIntro);
for (const button of buttons) {
  button.addEventListener("click", () => {
    stopIntro();
    apply(Number(button.dataset.atlasView));
  });
}

const images = [...stage.querySelectorAll("img")];
if (!(motion.matches || navigator.connection?.saveData)) {
  render(92);
  Promise.all(images.map((image) => image.decode()))
    .then(() => {
      if (used || motion.matches) {
        return;
      }
      const start = performance.now();
      const intro = (now) => {
        if (used) {
          return;
        }
        if (motion.matches || document.hidden) {
          apply(43);
          return;
        }
        const progress = Math.min(1, Math.max(0, (now - start - 140) / 1250));
        const eased = 1 - (1 - progress) ** 3;
        render(92 - 49 * eased);
        if (progress < 1) {
          frame = requestAnimationFrame(intro);
        } else {
          apply(43);
        }
      };
      frame = requestAnimationFrame(intro);
    })
    .catch(() => {
      if (!used) {
        apply(43);
      }
    });
}
