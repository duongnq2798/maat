<#
.SYNOPSIS
  Opens the two terminals that run Maat on the owner's Windows PC: MAAT AGENT and MAAT JOURNAL.

.DESCRIPTION
  MAAT AGENT runs the agent's restart loop, "npm run agent:loop", in <Root>\agent.
  MAAT JOURNAL runs the journal publisher, "node ops\journal\publish.mjs", in <Root>.
  These are the commands of the Windows runbook (web/content/docs/guides/run-the-agent-on-windows.mdx, "Start the
  restart loop") and of ops/journal/README.md ("Start it"). The agent starts in the mode that agent\.env sets.

  With Windows Terminal (wt.exe) it opens one new window with two tabs, titled MAAT AGENT and MAAT JOURNAL. Without
  it, or with -NoWindowsTerminal, it opens two Windows PowerShell windows with those titles. Each shell stays open
  after its command ends (-NoExit), so its last lines can be read; Ctrl-C in a tab stops that tab's command. The
  script itself exits at once, and the tabs or windows do not depend on it.

  It reads no .env file and passes no secret: the agent and the publisher read agent\.env themselves. It opens
  nothing when an agent already runs on agent\data (see ops/windows/README.md).

.PARAMETER Root
  The checkout to run from: the folder that holds agent\ and ops\. Default: the repository that holds this script.

.PARAMETER NoWindowsTerminal
  Open two Windows PowerShell windows even when wt.exe is installed.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\start-maat.ps1 -WhatIf
  Prints what it would open, and opens nothing.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\start-maat.ps1 -Root E:\maat
  Opens both terminals for the checkout in E:\maat.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Root = '',
  [switch]$NoWindowsTerminal
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

function Exit-StartMaat([string]$Message) {
  $Host.UI.WriteErrorLine("start-maat: $Message")
  exit 1
}

if ($Root -eq '') { $Root = Join-Path $PSScriptRoot '..\..' }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { Exit-StartMaat "$Root is not a folder." }
$Root = (Resolve-Path -LiteralPath $Root).ProviderPath
foreach ($need in @('agent\package.json', 'ops\journal\publish.mjs')) {
  if (-not (Test-Path -LiteralPath (Join-Path $Root $need) -PathType Leaf)) {
    Exit-StartMaat "$Root is not a Maat checkout: it has no $need. Give -Root the folder that holds agent\ and ops\."
  }
}

# One agent per data folder. The lock names the pid of the agent that holds agent\data, the live folder by default;
# a pid that now belongs to a process other than node is a lock left by an agent that has gone, which the agent
# itself handles at its start.
$lock = Join-Path $Root 'agent\data\agent.lock'
if (Test-Path -LiteralPath $lock -PathType Leaf) {
  $text = "$(Get-Content -LiteralPath $lock -Raw -ErrorAction SilentlyContinue)".Trim()
  # The agent writes "<pid> <host>" (agent/src/loop/lock.ts); an older agent wrote a bare pid.
  if ($text -match '^(\d{1,9})(?:\s+(\S+))?$') {
    $lockPid = [int]$Matches[1]
    $lockHost = $Matches[2]
    if ($lockHost -and $lockHost -ne [System.Net.Dns]::GetHostName()) {
      Exit-StartMaat "agent\data\agent.lock names another host ($lockHost), and the agent refuses such a lock, so nothing was opened. Check which machine runs the agent before you delete the lock."
    }
    $holder = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
    if ($null -ne $holder -and $holder.ProcessName -eq 'node') {
      Exit-StartMaat "an agent (pid $lockPid) already runs on agent\data (lock $lock), so nothing was opened. Stop it with Ctrl-C in its tab first."
    }
  }
}

$tabs = @(
  @{ Title = 'MAAT AGENT'; Dir = (Join-Path $Root 'agent'); Command = 'npm run agent:loop' },
  @{ Title = 'MAAT JOURNAL'; Dir = $Root; Command = 'node ops\journal\publish.mjs' }
)

# What each shell runs, passed with -EncodedCommand so that no path or quote has to survive a command line.
function Get-TabScript([hashtable]$Tab) {
  $dir = $Tab.Dir -replace "'", "''"
  $lines = @(
    ('$Host.UI.RawUI.WindowTitle = ''{0}''' -f $Tab.Title),
    ('Set-Location -LiteralPath ''{0}''' -f $dir),
    ('Write-Host ''{0}: {1} in {2}''' -f $Tab.Title, $Tab.Command, $dir),
    $Tab.Command
  )
  return ($lines -join "`n")
}

function Get-Encoded([hashtable]$Tab) {
  return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Get-TabScript $Tab)))
}

$wt = $null
if (-not $NoWindowsTerminal) { $wt = Get-Command wt.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 }

foreach ($tab in $tabs) { Write-Host ('start-maat: {0}: {1} in {2}' -f $tab.Title, $tab.Command, $tab.Dir) }

if ($null -ne $wt) {
  $parts = foreach ($tab in $tabs) {
    'new-tab --title "{0}" --suppressApplicationTitle powershell.exe -NoExit -EncodedCommand {1}' -f $tab.Title, (Get-Encoded $tab)
  }
  $wtArgs = '-w new ' + ($parts -join ' ; ')
  Write-Host "start-maat: as two tabs of a new Windows Terminal window ($($wt.Source))"
  Write-Verbose "wt.exe $wtArgs"
  if ($PSCmdlet.ShouldProcess('a new Windows Terminal window', 'Open the tabs MAAT AGENT and MAAT JOURNAL')) {
    Start-Process -FilePath $wt.Source -ArgumentList $wtArgs
  }
} else {
  Write-Host 'start-maat: as two Windows PowerShell windows (no wt.exe, or -NoWindowsTerminal)'
  foreach ($tab in $tabs) {
    if ($PSCmdlet.ShouldProcess($tab.Title, "Open a Windows PowerShell window that runs $($tab.Command) in $($tab.Dir)")) {
      Start-Process -FilePath 'powershell.exe' -WorkingDirectory $tab.Dir -ArgumentList ('-NoExit -EncodedCommand ' + (Get-Encoded $tab))
    }
  }
}
exit 0
