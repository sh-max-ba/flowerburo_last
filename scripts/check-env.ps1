param(
  [string]$Distro = "",
  [int]$Port = 3000
)

$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $PSScriptRoot
$WslNodeBin = "/home/zxc/.local/flowerops-node/bin"
$WslPath = "${WslNodeBin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title =="
}

function Get-FlowerOpsWslDistro {
  param([string]$RequestedDistro)

  if ($RequestedDistro) {
    return $RequestedDistro
  }

  $distros = @(wsl -l -q 2>$null | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ })
  if (-not $distros) {
    return $null
  }

  $ubuntu = $distros | Where-Object { $_ -like "Ubuntu*" } | Select-Object -First 1
  if ($ubuntu) {
    return $ubuntu
  }

  return ($distros | Select-Object -First 1)
}

Write-Section "Project"
Write-Host $Root

Write-Section "Windows tools"
foreach ($tool in @("node", "npm", "git", "ssh")) {
  $cmd = Get-Command $tool -ErrorAction SilentlyContinue
  if ($cmd) {
    Write-Host ("OK   {0}: {1}" -f $tool, $cmd.Source)
  } else {
    Write-Host ("MISS {0}" -f $tool)
  }
}

Write-Section "WSL"
$resolvedDistro = Get-FlowerOpsWslDistro -RequestedDistro $Distro
if ($resolvedDistro) {
  Write-Host "Distro: $resolvedDistro"
  try {
    wsl -d $resolvedDistro bash -lc "export PATH=$WslPath; hostname -I; node --version; npm --version; git --version; cd /mnt/c/Users/Administrator/Documents/FlowerOps; test -f app.db && ls -lh app.db || true"
  } catch {
    Write-Warning $_.Exception.Message
  }
} else {
  Write-Warning "No WSL distro visible to this Windows user/session."
}

Write-Section "Portproxy"
netsh interface portproxy show all

Write-Section "Local web"
try {
  $response = Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 8
  Write-Host ("OK   http://localhost:{0}/login -> {1}" -f $Port, $response.StatusCode)
} catch {
  Write-Host ("FAIL http://localhost:{0}/login -> {1}" -f $Port, $_.Exception.Message)
}

Write-Section "Codex skills"
$SkillRoot = Join-Path $env:USERPROFILE ".codex\skills"
foreach ($skill in @("coss", "coss-particles", "design-taste-frontend", "playwright", "playwright-interactive", "screenshot")) {
  $path = Join-Path $SkillRoot $skill
  if (Test-Path $path) {
    Write-Host "OK   $skill"
  } else {
    Write-Host "MISS $skill"
  }
}
