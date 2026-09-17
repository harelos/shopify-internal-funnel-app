window.__fceFrames = [];
const startedAt = performance.now();
if (new URLSearchParams(location.search).has("slow")) {
  const configNode = document.querySelector("[data-funnel-control-config]");
  const config = JSON.parse(configNode.textContent);
  config.endpoint = "/apps/funnels-slow";
  configNode.textContent = JSON.stringify(config);
}

function sampleFrame() {
  const target = document.querySelector(".nova .hero-media");
  const opacity = Number.parseFloat(getComputedStyle(target).opacity || "1");
  const frame = {
    elapsedMs: Math.round(performance.now() - startedAt),
    visible: opacity > 0.95,
    containsOriginal: target.textContent.includes("ORIGINAL CONTROL GALLERY"),
    variant: target.dataset.experimentVariant || null,
    ready: target.dataset.fceReady || null
  };
  window.__fceFrames.push(frame);
  document.documentElement.dataset.qaFrameCount = String(window.__fceFrames.length);
  if (frame.visible && frame.containsOriginal) document.documentElement.dataset.qaVisibleOriginal = "true";
  if (frame.visible && frame.variant === "variant-b") document.documentElement.dataset.qaVisibleChallenger = "true";
}

sampleFrame();
const sampler = setInterval(sampleFrame, 10);
setTimeout(() => clearInterval(sampler), 1250);
