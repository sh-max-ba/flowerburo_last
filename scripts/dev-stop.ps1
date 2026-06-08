param(
  [string]$Distro = ""
)

$ErrorActionPreference = "Stop"

$WslRoot = "/mnt/c/Users/Administrator/Documents/FlowerOps"

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

$Distro = Get-FlowerOpsWslDistro -RequestedDistro $Distro
if ($Distro) {
  wsl -d $Distro bash -lc "pkill -f '$WslRoot.*next dev' || true; pkill -f '$WslRoot.*npm run dev' || true"
  Write-Host "Stopped FlowerOps dev processes."
} else {
  Write-Warning "WSL distro not found; skipped WSL dev process stop."
}
