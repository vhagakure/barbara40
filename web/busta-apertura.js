const hero = document.querySelector('.hero');
const stage = hero.querySelector('.hero-stage');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let frame = 0;
let activeTime;
let target = 0;
let displayedProgress;
let needsMeasure = true;

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function ease(progress, start, end) {
  const position = clamp((progress - start) / (end - start));
  return position * position * (3 - 2 * position);
}

function paint(progress) {
  const fold = Math.cos(Math.PI * ease(progress, 0, 0.46));
  const letter = ease(progress, 0.13, 0.87);
  const intro = 1 - ease(progress, 0.12, 0.32);

  hero.style.setProperty('--flap-front', Math.max(0, fold));
  hero.style.setProperty('--flap-back', Math.min(0, fold));
  hero.style.setProperty('--letter-rise', letter);
  hero.style.setProperty('--field-growth', ease(progress, 0.10, 0.7));
  hero.style.setProperty('--envelope-drop', ease(progress, 0.53, 0.95));
  hero.style.setProperty('--seal-opacity', 1 - ease(progress, 0.07, 0.32));
  hero.style.setProperty('--intro-opacity', intro);
  hero.toggleAttribute('data-hide-cue', intro <= 0);
}

function readProgress() {
  const travel = hero.offsetHeight - stage.offsetHeight;
  if (travel <= 0) return 0;
  return clamp((hero.offsetTop - hero.getBoundingClientRect().top) / travel);
}

function render(time) {
  frame = 0;
  const reduceMotion = motionPreference.matches;

  if (needsMeasure) {
    const progress = readProgress();
    target = reduceMotion ? Number(progress >= 0.22) : progress;
    needsMeasure = false;
  }

  if (displayedProgress === undefined || reduceMotion) {
    displayedProgress = target;
  } else {
    const elapsed = Math.min(34, activeTime === undefined ? 16.67 : time - activeTime);
    const difference = target - displayedProgress;
    const step = difference * (1 - Math.exp(-elapsed / 43));
    const limit = Math.min(0.075, elapsed / 210);
    displayedProgress += Math.sign(step) * Math.min(Math.abs(step), limit);
    if (Math.abs(target - displayedProgress) < 0.001) displayedProgress = target;
  }

  paint(displayedProgress);
  activeTime = displayedProgress === target ? undefined : time;
  if (activeTime !== undefined) schedule();
}

function schedule() {
  if (frame === 0) frame = requestAnimationFrame(render);
}

function syncToPage() {
  needsMeasure = true;
  schedule();
}

document.documentElement.classList.add('scroll-invite');
window.addEventListener('scroll', syncToPage, { passive: true });
window.addEventListener('resize', syncToPage);
window.addEventListener('pageshow', syncToPage);
motionPreference.addEventListener('change', syncToPage);
render(performance.now());
