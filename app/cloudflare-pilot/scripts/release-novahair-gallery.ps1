$ErrorActionPreference = "Stop"

$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$PilotRoot = Split-Path -Parent $ScriptDirectory
$Wrangler = Join-Path $PilotRoot "node_modules\.bin\wrangler.cmd"
$ReleaseStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$EvidenceDirectory = Join-Path $PilotRoot "release-evidence\novahair-gallery-$ReleaseStamp"
$DryRunDirectory = Join-Path $EvidenceDirectory "worker-bundle"
$PreviewUrl = "https://novahair-gallery-ab-qa-shopify-funnel-control.tigerbrands-funnel.workers.dev"
$ProductionUrl = "https://shopify-funnel-control.tigerbrands-funnel.workers.dev"
$ExistingEdgeHarness = "C:\Users\Lenovo\Desktop\Shopify-Internal-Funnel-App\popup-engine\ai-popup\harness\verify_edge_preview.cjs"

if (-not (Test-Path -LiteralPath $Wrangler)) {
  throw "Wrangler is missing from this self-contained release bundle."
}

New-Item -ItemType Directory -Path $DryRunDirectory -Force | Out-Null
$env:WRANGLER_WRITE_LOGS = "false"

Push-Location $PilotRoot
try {
  Write-Host "[1/10] Verifying Cloudflare identity"
  & $Wrangler whoami
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare identity check failed." }

  Write-Host "[2/10] Building the exact Worker bundle without a live write"
  & $Wrangler deploy --config .\wrangler.jsonc --dry-run --outdir $DryRunDirectory
  if ($LASTEXITCODE -ne 0) { throw "Worker dry-run build failed." }

  Write-Host "[3/10] Recording the current Worker deployments"
  & $Wrangler deployments list 2>&1 | Tee-Object -FilePath (Join-Path $EvidenceDirectory "deployments-before.txt")
  if ($LASTEXITCODE -ne 0) { throw "Could not record the current Worker deployment." }

  Write-Host "[4/10] Exporting a recoverable D1 snapshot"
  & $Wrangler d1 export shopify-funnel-control-db --remote --output (Join-Path $EvidenceDirectory "d1-before.sql")
  if ($LASTEXITCODE -ne 0) { throw "D1 backup failed; release stopped before writes." }

  Write-Host "[5/10] Uploading an isolated preview version"
  & $Wrangler versions upload --config .\wrangler.jsonc --keep-vars --preview-alias novahair-gallery-ab-qa --message "NovaHair gallery A/B release candidate"
  if ($LASTEXITCODE -ne 0) { throw "Preview upload failed; production remains unchanged." }

  Write-Host "[6/10] Verifying preview health and runtime assets"
  $PreviewHealth = Invoke-WebRequest -UseBasicParsing -Uri "$PreviewUrl/api/health" -TimeoutSec 20
  if ($PreviewHealth.StatusCode -ne 200 -or $PreviewHealth.Content -notmatch '"status"\s*:\s*"ok"') { throw "Preview health check failed." }
  $PreviewRuntime = Invoke-WebRequest -UseBasicParsing -Uri "$PreviewUrl/assets/funnel-control-elements.js" -TimeoutSec 20
  if ($PreviewRuntime.StatusCode -ne 200 -or $PreviewRuntime.Content -notmatch 'funnel-control:experiment-exposed') { throw "Preview element runtime check failed." }

  Write-Host "[7/10] Running the existing signed proxy and AI regression harness"
  if (-not (Test-Path -LiteralPath $ExistingEdgeHarness)) { throw "The existing edge regression harness is missing; release stopped." }
  & node $ExistingEdgeHarness $PreviewUrl
  if ($LASTEXITCODE -ne 0) { throw "Existing popup/concierge edge regression failed; production remains unchanged." }

  Write-Host "[8/10] Applying additive D1 migrations"
  & $Wrangler d1 migrations apply shopify-funnel-control-db --remote
  if ($LASTEXITCODE -ne 0) { throw "D1 migration failed; production Worker was not deployed." }

  Write-Host "[9/10] Deploying with all existing secret variables preserved"
  & $Wrangler deploy --config .\wrangler.jsonc --keep-vars --message "NovaHair gallery 50-50 A/B infrastructure"
  if ($LASTEXITCODE -ne 0) { throw "Production Worker deployment failed." }

  Write-Host "[10/10] Verifying production health and runtime assets"
  $ProductionHealth = Invoke-WebRequest -UseBasicParsing -Uri "$ProductionUrl/api/health" -TimeoutSec 20
  if ($ProductionHealth.StatusCode -ne 200 -or $ProductionHealth.Content -notmatch '"status"\s*:\s*"ok"') { throw "Production health check failed after deployment. Use deployments-before.txt for rollback." }
  $ProductionRuntime = Invoke-WebRequest -UseBasicParsing -Uri "$ProductionUrl/assets/funnel-control-elements.js" -TimeoutSec 20
  if ($ProductionRuntime.StatusCode -ne 200 -or $ProductionRuntime.Content -notmatch 'funnel-control:experiment-exposed') { throw "Production element runtime check failed after deployment." }

  & $Wrangler deployments list 2>&1 | Tee-Object -FilePath (Join-Path $EvidenceDirectory "deployments-after.txt")
  Write-Host "RELEASE_GATE=PASS"
  Write-Host "Evidence: $EvidenceDirectory"
} finally {
  Pop-Location
}
