import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = 4177;

function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/apps/funnels/element-runtime/") || url.pathname.startsWith("/apps/funnels-slow/element-runtime/")) {
    const delay = url.pathname.startsWith("/apps/funnels-slow/") ? 1300 : 350;
    setTimeout(() => json(res, {
      active: true,
      slotId: "slot-fixture",
      slotKey: "novahair.sales.gallery.primary",
      templateType: "GALLERY",
      templateVersion: 1,
      experimentId: "experiment-fixture",
      experimentKey: "gallery-fixture",
      posthogFlagKey: "gallery-fixture",
      allocationVersion: 1,
      assignmentId: "assignment-fixture",
      variantId: "challenger-fixture",
      variantKey: "variant-b",
      isControl: false,
      contentRevision: 1,
      payload: {
        preserveExisting: false,
        initialIndex: 0,
        showThumbnails: true,
        items: [{ id: "proof", src: "/test-image.svg", alt: "Challenger image" }]
      }
    }), delay);
    return;
  }
  if ([
    "/apps/funnels/element-exposure",
    "/apps/funnels/element-cart-attribution",
    "/apps/funnels-slow/element-exposure",
    "/apps/funnels-slow/element-cart-attribution"
  ].includes(url.pathname)) {
    json(res, { accepted: true });
    return;
  }
  if (url.pathname === "/cart.js") {
    json(res, { token: "fixture-cart-token" });
    return;
  }
  if (url.pathname === "/test-image.svg") {
    res.writeHead(200, { "content-type": "image/svg+xml" });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900"><rect width="1000" height="900" fill="#f2e8df"/><text x="80" y="450">CHALLENGER</text></svg>');
    return;
  }
  const file = url.pathname === "/assets/funnel-control-elements.js"
    ? join(root, "public", "assets", "funnel-control-elements.js")
    : url.pathname === "/assets/antiflicker-observer.js"
      ? join(root, "test", "fixtures", "antiflicker-observer.js")
      : join(root, "test", "fixtures", "element-antiflicker.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`Anti-flicker QA server listening on http://127.0.0.1:${port}\n`);
});
