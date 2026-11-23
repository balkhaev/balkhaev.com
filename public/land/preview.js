const rendererUrl = "/land/model/valley-7b9ac24.js";
const stage = document.querySelector("#model-stage");
const host = document.querySelector("#model-canvas");
const labels = document.querySelector("#model-labels");
const poster = document.querySelector("#model-poster");
const controls = document.querySelector("#model-controls");
const open = document.querySelector("#model-open");
const close = document.querySelector("#model-close");
const status = document.querySelector("#model-status");
const viewButtons = document.querySelectorAll("[data-model-view]");

let scene;
let loading;
let visible = true;

function updateRenderState() {
  scene?.setActive(visible && !document.hidden);
}

function setView(view) {
  if (view === "plan") {
    const narrow = stage.clientWidth / stage.clientHeight < 1;
    scene.landmarks([]);
    scene.overlay(true);
    scene.camera({
      distance: narrow ? 27 : 23,
      elevation: 1.1,
      target: [-1.4, 1.57, 3.1],
      yaw: 2.63,
    });
  } else {
    scene.overlay(false);
    scene.landmarks(null);
    scene.view("valley", false);
  }
  for (const button of viewButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.modelView === view)
    );
  }
}

function reset(message = "") {
  const restoreFocus =
    stage.contains(document.activeElement) ||
    controls.contains(document.activeElement);
  loading?.abort();
  loading = undefined;
  scene?.dispose();
  scene = undefined;
  host.inert = true;
  labels.inert = true;
  controls.hidden = true;
  poster.hidden = false;
  open.hidden = false;
  open.disabled = false;
  open.textContent = message ? "Повторить" : "Открыть 3D";
  status.textContent = message;
  if (restoreFocus) {
    open.focus({ preventScroll: true });
  }
}

async function showModel() {
  const request = new AbortController();
  loading = request;
  open.disabled = true;
  open.textContent = "Загрузка 3D…";
  status.textContent = "Загружаем модель долины Катуни.";
  const fallback = () => {
    if (!request.signal.aborted) {
      reset("3D не загрузилось. Можно повторить или посмотреть генплан ниже.");
    }
  };
  try {
    const { createValleyScene } = await import(rendererUrl);
    request.signal.throwIfAborted();
    scene = await createValleyScene(host, {
      onError: fallback,
      sceneKey: "plan",
      signal: request.signal,
      strictGpu: false,
    });
    request.signal.throwIfAborted();
    setView("valley");
    updateRenderState();
    host.inert = false;
    labels.inert = false;
    poster.hidden = true;
    controls.hidden = false;
    open.hidden = true;
    status.textContent =
      "Потяните, чтобы повернуть камеру, или используйте стрелки. Колесо мыши, клавиши + и − или щипок меняют масштаб.";
    host.querySelector("canvas")?.focus({ preventScroll: true });
  } catch {
    fallback();
  }
}

open.hidden = false;
open.addEventListener("click", showModel);
close.addEventListener("click", () => reset());
for (const button of viewButtons) {
  button.addEventListener("click", () => setView(button.dataset.modelView));
}
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  updateRenderState();
}).observe(stage);
document.addEventListener("visibilitychange", updateRenderState);
window.addEventListener("pagehide", () => {
  if (loading) {
    reset();
  }
});
