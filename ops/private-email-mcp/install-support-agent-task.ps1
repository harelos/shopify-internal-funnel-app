param(
  [string]$TaskName = "Tiger Brands AI Support Agent"
)

$ErrorActionPreference = "Stop"
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runnerPath = Join-Path $agentRoot "start-support-agent.ps1"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`" -NodeExecutable `"$nodePath`""
$action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $agentRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Continuously syncs the Tiger Brands Namecheap support mailbox and sends explicitly approved or low-risk AI replies." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Scheduled task '$TaskName' is installed and started."
