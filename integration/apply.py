"""Apply additive gallery integration to a LOCAL copy only. Never deploys or calls an API."""
from pathlib import Path
import shutil,sys
HERE=Path(__file__).resolve().parent
BASE=Path(sys.argv[1]).resolve()
if not (BASE/'app/cloudflare-pilot/src/server.ts').is_file(): raise SystemExit('Expected a local pinned source checkout')
def edit(relative,old,new):
 p=BASE/relative;s=p.read_text()
 if s.count(old)!=1: raise SystemExit(f'Refusing ambiguous or already-applied edit: {relative}')
 p.write_text(s.replace(old,new,1))
for p in (HERE/'overlay').rglob('*'):
 if p.is_file():
  target=BASE/p.relative_to(HERE/'overlay');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
P='app/cloudflare-pilot/'
edit(P+'src/server.ts','import { elementAdminRouter, elementRuntimeRouter }','import { galleryBootstrapAdmin, galleryBootstrapRuntime } from "./routes/gallery-bootstrap.js";\nimport { elementAdminRouter, elementRuntimeRouter }')
edit(P+'src/server.ts','app.use("/apps/funnels", elementRuntimeRouter);','app.use("/apps/funnels", galleryBootstrapRuntime);\napp.use("/apps/funnels", elementRuntimeRouter);')
edit(P+'src/server.ts','app.use("/api", elementAdminRouter);','app.use("/api", galleryBootstrapAdmin);\napp.use("/api", elementAdminRouter);')
edit(P+'src/routes/shopify-ingest.ts','import prisma from "../lib/db.js";','import prisma from "../lib/db.js";\nimport { pendingGalleryContexts } from "../services/gallery-bootstrap.js";')
edit(P+'src/routes/shopify-ingest.ts','if (eventResult.duplicate) return res.json({ accepted: true, duplicate: true });','if (eventResult.duplicate && !rawContext.pendingGalleryBootstrap) return res.json({ accepted: true, duplicate: true });')
edit(P+'src/routes/shopify-ingest.ts','      if (visitor) {\n        const captured = await snapshotCheckoutElementAssignments({','''      if (visitor) {
        let bootstrapContexts: any[] = [];
        try { bootstrapContexts = await pendingGalleryContexts(rawContext, context.visitorId!); }
        catch (_error) { console.warn("Gallery bootstrap checkout context was not resolved; no inferred attribution added."); }
        const captured = await snapshotCheckoutElementAssignments({''')
edit(P+'src/routes/shopify-ingest.ts','contexts: normalizeElementAssignmentContexts(rawContext.elementAssignments),','contexts: normalizeElementAssignmentContexts([...(Array.isArray(rawContext.elementAssignments) ? rawContext.elementAssignments : []), ...bootstrapContexts]),')
edit(P+'src/routes/shopify-ingest.ts','    if (!normalized.value.isInternal && normalized.value.posthogDistinctId) {','    if (eventResult.duplicate) return res.json({ accepted: true, duplicate: true });\n    if (!normalized.value.isInternal && normalized.value.posthogDistinctId) {')
edit(P+'storefront-source/funnel-control-attribution.js','        var value = JSON.stringify(checkoutContext), root =','''        if (context.pendingGalleryBootstrap) checkoutContext.pendingGalleryBootstrap = context.pendingGalleryBootstrap;
        if (Array.isArray(context.elementAssignments)) checkoutContext.elementAssignments = context.elementAssignments.slice(-4);
        var value = JSON.stringify(checkoutContext), root =''')
shutil.copyfile(HERE/'storefront/gallery-bootstrap.js',BASE/(P+'storefront-source/gallery-bootstrap.js'))
shutil.copyfile(HERE/'storefront/gallery-bootstrap.css',BASE/(P+'storefront-source/gallery-bootstrap.css'))
print('Applied gallery-only overlay. No configuration, theme, production DB, or remote resource changed.')
