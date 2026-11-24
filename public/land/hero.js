const video = document.querySelector("#hero-motion");
const toggle = document.querySelector("#hero-motion-toggle");
const label = document.querySelector("#hero-motion-label");
const narrow = matchMedia("(max-width: 720px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function updateControl() {
  label.textContent = video.paused ? "Включить полёт" : "Остановить полёт";
}

async function play() {
  if (!video.getAttribute("src")) {
    video.src = narrow.matches ? "/land/hero-portrait.mp4" : "/land/hero.mp4";
  }
  try {
    await video.play();
  } catch {
    updateControl();
  }
}

toggle.hidden = false;
toggle.addEventListener("click", () => {
  if (video.paused) {
    play();
  } else {
    video.pause();
  }
});
video.addEventListener("playing", () => {
  video.classList.add("has-frame");
  updateControl();
});
video.addEventListener("pause", updateControl);
video.addEventListener("ended", updateControl);
video.addEventListener("error", () => {
  video.classList.remove("has-frame");
  toggle.hidden = true;
});
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    video.pause();
    video.classList.remove("has-frame");
  }
});
new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) {
    video.pause();
  }
}).observe(video);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    video.pause();
  }
});

if (
  !(narrow.matches || reducedMotion.matches || navigator.connection?.saveData)
) {
  if (document.readyState === "complete") {
    play();
  } else {
    window.addEventListener("load", play, { once: true });
  }
}
