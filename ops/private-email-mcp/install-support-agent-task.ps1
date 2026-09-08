param(
  [string]$TaskName = "Tiger Brands AI Support Agent"
)

$ErrorActionPreference = "Stop"
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$watcherPath = Join-Path $agentRoot "src\support-sync.mjs"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$arguments = "`"$watcherPath`" --watch"
$action = New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory $agentRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Continuously syncs the Tiger Brands Namecheap support mailbox and sends explicitly approved or low-risk AI replies." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Scheduled task '$TaskName' is installed and started."
