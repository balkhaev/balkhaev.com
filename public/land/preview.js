const rendererUrl = "/land/model/valley-7b9ac24.js";
const stage = document.querySelector("#model-stage");
const host = document.querySelector("#model-canvas");
const labels = document.querySelector("#model-labels");
const poster = document.querySelector("#model-poster");
const controls = document.querySelector("#model-controls");
const open = document.querySelector("#model-open");
const close = document.querySelector("#model-close");
const status = document.querySelector("#model-status");
const note = document.querySelector("#model-view-note");
const viewButtons = controls.querySelectorAll("[data-model-view]");
const views = {
  bridge: {
    alt: "3D-модель Катуни и подвесного моста",
    file: "river.webp",
    note: "Подвесной мост через Катунь и скальные выходы у воды.",
  },
  plan: {
    alt: "Контуры участков на рельефе и застройка посёлка",
    file: "plots.webp",
    note: "Улицы, границы участков и будущая застройка на рельефе.",
  },
  valley: {
    alt: "3D-модель долины Катуни и окрестностей Аноса",
    file: "story-valley.webp",
    note: "Горный рельеф, русло Катуни, Анос и леса по обе стороны долины.",
  },
  village: {
    alt: "3D-модель села Анос с улицами и домами",
    file: "anos.webp",
    note: "Улицы Аноса и здания по картографическим контурам.",
  },
};

let scene;
let lifetime;
let visible = true;
let currentView = "valley";

function updateRenderState() {
  scene?.setActive(visible && !document.hidden);
}

function showPoster() {
  const { alt, file } = views[currentView];
  poster.alt = alt;
  poster.src = `/land/model/${file}`;
}

function syncView(view) {
  if (!Object.hasOwn(views, view)) {
    return;
  }
  currentView = view;
  note.textContent = views[view].note;
  for (const button of viewButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.modelView === view)
    );
  }
}

function updateLayers(view) {
  scene.landmarks(
    view === "valley" ? ["Анос", "Катунь", "Подвесной мост"] : []
  );
  scene.overlay(view === "plan");
}

function setView(view) {
  syncView(view);
  if (!scene) {
    showPoster();
    return;
  }
  updateLayers(view);
  if (view === "plan") {
    const narrow = stage.clientWidth / stage.clientHeight < 1;
    scene.camera({
      distance: narrow ? 27 : 23,
      elevation: 1.1,
      target: [-1.4, 1.57, 3.1],
      yaw: 2.63,
    });
  } else {
    scene.view(view, false);
  }
}

function reset(message = "") {
  const restoreFocus =
    stage.contains(document.activeElement) || document.activeElement === close;
  lifetime?.abort();
  lifetime = undefined;
  scene?.dispose();
  scene = undefined;
  host.inert = true;
  labels.inert = true;
  close.hidden = true;
  showPoster();
  poster.hidden = false;
  open.hidden = false;
  open.disabled = false;
  open.textContent = message ? "Повторить" : "Запустить модель";
  status.textContent = message;
  if (restoreFocus) {
    open.focus({ preventScroll: true });
  }
}

async function showModel() {
  if (lifetime) {
    return;
  }
  const request = new AbortController();
  lifetime = request;
  open.disabled = true;
  open.textContent = "Загрузка 3D…";
  status.textContent = "Загружаем модель долины Катуни.";
  const fallback = () => {
    if (!request.signal.aborted) {
      reset(
        "Не удалось загрузить 3D. Можно повторить или открыть плоский генплан."
      );
    }
  };
  try {
    const { createValleyScene } = await import(rendererUrl);
    request.signal.throwIfAborted();
    const rendered = await createValleyScene(host, {
      onError: fallback,
      onView(view) {
        syncView(view);
        if (scene) {
          updateLayers(currentView);
        }
      },
      sceneKey: "plan",
      signal: request.signal,
      strictGpu: false,
    });
    request.signal.throwIfAborted();
    scene = rendered;
    setView(currentView);
    updateRenderState();
    host.inert = false;
    labels.inert = false;
    poster.hidden = true;
    close.hidden = false;
    open.hidden = true;
    status.textContent =
      "Поворот перетаскиванием или стрелками. Масштаб колесом, щипком или клавишами + и −.";
    if (visible) {
      host.querySelector("canvas")?.focus({ preventScroll: true });
    }
  } catch {
    fallback();
  }
}

controls.hidden = false;
open.hidden = false;
open.addEventListener("click", showModel);
close.addEventListener("click", () => reset());
for (const button of viewButtons) {
  button.addEventListener("click", () => setView(button.dataset.modelView));
}
for (const link of document.querySelectorAll("[data-start-model]")) {
  link.addEventListener("click", () => {
    setView(link.dataset.startModel);
    showModel();
  });
}
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  updateRenderState();
}).observe(stage);
document.addEventListener("visibilitychange", updateRenderState);
window.addEventListener("pagehide", () => {
  if (lifetime) {
    reset();
  }
});
