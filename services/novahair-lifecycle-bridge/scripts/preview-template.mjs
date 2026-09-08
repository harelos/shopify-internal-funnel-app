import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const alias = process.argv[2] ?? "novahair_abandoned_checkout_e01";
if (!/^novahair_[a-z_]+_e\d{2}$/.test(alias)) throw new Error("invalid_template_alias");
const htmlPath = resolve("dist", "templates", "html", `${alias}.html`);
const outputPath = resolve("dist", "previews", `${alias}.png`);
const playwrightPath = process.env.PLAYWRIGHT_MODULE_PATH
  ?? "C:/Users/Lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwrightPath).href);

const variables = {
  CUSTOMER_NAME: "הראל",
  CTA_URL: "https://tigerbrandsglobal.com/pages/novahair-sales?utm_source=resend&utm_medium=email&utm_campaign=novahair_preview&utm_content=e01_preview",
  PRODUCT_NAME: "NOVAHAIR — ערכת צביעה ביתית לשיער",
  VARIANT: "חום כהה",
  BUNDLE: "2 בקבוקים",
  RESEND_UNSUBSCRIBE_URL: "https://example.invalid/unsubscribe",
};
let html = await readFile(htmlPath, "utf8");
for (const [key, value] of Object.entries(variables)) {
  html = html.replaceAll(`{{{${key}}}}`, value).replaceAll(`{{${key}}}`, value);
}
await mkdir(dirname(outputPath), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Array.from(document.images).every(image => image.complete),
    undefined,
    { timeout: 10_000 },
  ).catch(() => undefined);
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(outputPath);
} finally {
  await browser.close();
}
