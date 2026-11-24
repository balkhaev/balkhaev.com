const stage = document.querySelector("#plan-stage");
const canvas = document.querySelector("#plan-canvas");
const poster = document.querySelector("#plan-poster");
const scaleBar = document.querySelector("#plan-scale");
const form = document.querySelector("#plan-search");
const filters = document.querySelector("#plan-filters");
const numberInput = document.querySelector("#plot-number");
const hint = document.querySelector("#plan-hint");
const result = document.querySelector("#plan-result");
let pendingPreview;
let previewPlot;

const shades = ["", "#7b9f76", "#6a9295", "#b88a50"];
const phaseNames = [
  "",
  "Первая очередь",
  "Верхние террасы",
  "Коммерческая очередь",
];
const format = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
const lotNumber = /^\d{1,3}$/;

function point([u, v]) {
  // Project the site's survey coordinates onto the north-up map.
  return [0.6434 * u + 0.7655 * v, 0.7655 * u - 0.6434 * v];
}

function pathFrom(rings, close = true) {
  const path = new Path2D();
  for (const ring of rings) {
    const [start, ...rest] = ring.map(point);
    path.moveTo(...start);
    for (const location of rest) {
      path.lineTo(...location);
    }
    if (close) {
      path.closePath();
    }
  }
  return path;
}

function bounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function startPlan(data, context) {
  const phases = data.phases.map(({ id, shapes }) => ({
    id,
    path: pathFrom(shapes.flat()),
    points: shapes.flat(2).map(point),
  }));
  const places = data.places.map(({ phase, park, shapes }) => ({
    park,
    path: pathFrom(shapes.flat()),
    phase,
  }));
  const streetPath = pathFrom(data.streets, false);
  const lots = data.lots.map(({ center, outline, ...lot }) => ({
    ...lot,
    center: point(center),
    path: pathFrom([outline]),
  }));
  const lotByNumber = new Map(lots.map((lot) => [lot.number, lot]));
  const areas = [phases, ...phases.map((phase) => [phase])].map((group) =>
    bounds(group.flatMap((phase) => phase.points))
  );
  let selectedPhase = 0;
  let selected;
  let frame;

  function paint() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!(width && height)) {
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);

    const [minX, minY, maxX, maxY] = selected
      ? [
          selected.center[0] - 105,
          selected.center[1] - 105,
          selected.center[0] + 105,
          selected.center[1] + 105,
        ]
      : areas[selectedPhase];
    const padding = Math.min(width, height) * 0.09;
    const scale = Math.min(
      (width - padding * 2) / (maxX - minX),
      (height - padding * 2) / (maxY - minY)
    );
    const x = (width - (maxX + minX) * scale) / 2;
    const y = (height - (maxY + minY) * scale) / 2;
    frame = { scale, x, y };
    context.translate(x, y);
    context.scale(scale, scale);
    scaleBar.style.width = `${100 * scale}px`;

    function drawShape(path, fill, stroke, lineWidth, faded = false) {
      context.globalAlpha = faded ? 0.26 : 1;
      context.fillStyle = fill;
      context.fill(path, "evenodd");
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth / scale;
      context.stroke(path);
    }

    for (const zone of phases) {
      drawShape(
        zone.path,
        "#ccd4bf",
        "#788b74",
        1.3,
        selectedPhase !== 0 && zone.id !== selectedPhase
      );
    }
    for (const place of places) {
      drawShape(
        place.path,
        place.park ? "#aebf9f" : "#dfcfaa",
        "#8c9b7e",
        0.7,
        selectedPhase !== 0 && place.phase !== selectedPhase
      );
    }
    context.globalAlpha = 0.8;
    context.strokeStyle = "#f9f4e5";
    context.lineWidth = 5;
    context.stroke(streetPath);
    for (const lot of lots) {
      drawShape(
        lot.path,
        shades[lot.phase],
        "#f3f0e5",
        0.7,
        selectedPhase !== 0 && lot.phase !== selectedPhase
      );
    }

    if (selected) {
      drawShape(selected.path, "#f3c96c", "#6d4b22", 2);
    }
  }

  function selectPhase(next, lot) {
    selectedPhase = next;
    selected = lot;
    for (const button of filters.querySelectorAll("[data-phase]")) {
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.phase) === selectedPhase)
      );
    }
    result.textContent = selected
      ? [
          `Участок №${selected.number}`,
          `${format.format(selected.area / 100)} сот.`,
          phaseNames[selected.phase],
          selected.street,
        ]
          .filter(Boolean)
          .join(" · ")
      : phaseNames[selectedPhase];
    paint();
  }

  previewPlot = (number) => {
    const lot = lotByNumber.get(number);
    if (lot) {
      numberInput.value = String(lot.number);
      selectPhase(lot.phase, lot);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = numberInput.value.trim();
    const lot = lotNumber.test(value) && lotByNumber.get(Number(value));
    if (lot) {
      selectPhase(lot.phase, lot);
    } else {
      result.textContent =
        "Такого номера нет в генплане. Введите число от 1 до 568.";
    }
  });

  for (const button of filters.querySelectorAll("[data-phase]")) {
    button.addEventListener("click", () => {
      numberInput.value = "";
      selectPhase(Number(button.dataset.phase));
    });
  }

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - frame.x) / frame.scale;
    const y = (event.clientY - rect.top - frame.y) / frame.scale;
    context.save();
    context.resetTransform();
    const lot = lots.find(
      (item) =>
        (selectedPhase === 0 || item.phase === selectedPhase) &&
        context.isPointInPath(item.path, x, y)
    );
    context.restore();
    if (lot) {
      numberInput.value = String(lot.number);
      selectPhase(lot.phase, lot);
    }
  });

  canvas.hidden = false;
  poster.hidden = true;
  scaleBar.hidden = false;
  form.hidden = false;
  filters.hidden = false;
  hint.textContent = "Выберите участок на схеме или найдите его по номеру.";
  if (pendingPreview) {
    previewPlot(pendingPreview);
  } else {
    paint();
  }
  new ResizeObserver(paint).observe(stage);
}

async function loadPlan() {
  try {
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const response = await fetch("/land/model/masterplan.json");
    if (!response.ok) {
      throw new Error("Master plan unavailable");
    }
    startPlan(await response.json(), context);
  } catch {
    hint.textContent = "Схема не загрузилась. Посёлок можно посмотреть в 3D.";
  }
}

const observer = new IntersectionObserver(
  ([entry]) => {
    if (entry.isIntersecting) {
      observer.disconnect();
      loadPlan();
    }
  },
  { rootMargin: "240px" }
);
observer.observe(stage);

for (const link of document.querySelectorAll("[data-preview-plot]")) {
  link.addEventListener("click", () => {
    pendingPreview = Number(link.dataset.previewPlot);
    previewPlot?.(pendingPreview);
  });
}
