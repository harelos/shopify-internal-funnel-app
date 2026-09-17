param(
  [string]$NodeExecutable = ""
)

$ErrorActionPreference = "Stop"
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataRoot = Join-Path $agentRoot ".data"
$logPath = Join-Path $dataRoot "support-agent.log"

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null

if (-not $NodeExecutable) {
  $NodeExecutable = (Get-Command node -ErrorAction Stop).Source
}

$requiredVariables = @(
  "NAMECHEAP_PRIVATE_EMAIL_USER",
  "NAMECHEAP_PRIVATE_EMAIL_PASSWORD",
  "SUPPORT_APP_URL",
  "SUPPORT_CONNECTOR_TOKEN"
)

$missingVariables = @($requiredVariables | Where-Object { -not [Environment]::GetEnvironmentVariable($_) })
if ($missingVariables.Count -gt 0) {
  throw "Missing support agent configuration: $($missingVariables -join ', ')"
}

$mutex = [Threading.Mutex]::new($false, "Local\TigerBrandsGlobalAISupportAgent")
if (-not $mutex.WaitOne(0)) {
  exit 0
}

try {
  while ($true) {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 10MB) {
      $archivePath = Join-Path $dataRoot "support-agent.previous.log"
      Move-Item -LiteralPath $logPath -Destination $archivePath -Force
    }

    $startedAt = Get-Date -Format o
    Add-Content -LiteralPath $logPath -Value "[$startedAt] Starting Namecheap AI support watcher."
    & $NodeExecutable (Join-Path $agentRoot "src\support-sync.mjs") "--watch" *>> $logPath
    $exitCode = $LASTEXITCODE
    $stoppedAt = Get-Date -Format o
    Add-Content -LiteralPath $logPath -Value "[$stoppedAt] Watcher exited with code $exitCode; restarting in 15 seconds."
    Start-Sleep -Seconds 15
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
