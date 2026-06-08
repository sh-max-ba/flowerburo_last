param(
  [string]$Distro = "",
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$LogPath = Join-Path $Root ".codex-dev.log"
$WslRoot = "/mnt/c/Users/Administrator/Documents/FlowerOps"
$NodeBin = "/home/zxc/.local/flowerops-node/bin"
$PathValue = "${NodeBin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

function Get-FlowerOpsWslDistro {
  param([string]$RequestedDistro)

  if ($RequestedDistro) {
    return $RequestedDistro
  }

  $distros = @(wsl -l -q 2>$null | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ })
  if (-not $distros) {
    throw "WSL distro not found. Start Ubuntu/WSL once, then rerun this script."
  }

  $ubuntu = $distros | Where-Object { $_ -like "Ubuntu*" } | Select-Object -First 1
  if ($ubuntu) {
    return $ubuntu
  }

  return ($distros | Select-Object -First 1)
}

$Distro = Get-FlowerOpsWslDistro -RequestedDistro $Distro
$ipLine = wsl -d $Distro bash -lc "hostname -I"
$wslIp = (($ipLine -split "\s+") | Where-Object { $_ } | Select-Object -First 1)
if (-not $wslIp) {
  throw "Could not determine WSL IP for distro '$Distro'."
}

netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$Port 2>$null | Out-Null
netsh interface portproxy delete v6tov4 listenaddress=::1 listenport=$Port 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$Port connectaddress=$wslIp connectport=$Port | Out-Null
netsh interface portproxy add v6tov4 listenaddress=::1 listenport=$Port connectaddress=$wslIp connectport=$Port | Out-Null

$script = "cd $WslRoot && PATH=$PathValue $NodeBin/npm run dev -- --hostname 0.0.0.0 --port $Port > $WslRoot/.codex-dev.log 2>&1"
$process = Start-Process -FilePath "wsl.exe" -ArgumentList @("-d", $Distro, "bash", "-lc", $script) -WindowStyle Hidden -PassThru

Write-Host "Started FlowerOps dev via WSL PID=$($process.Id)"
Write-Host "WSL distro: $Distro"
Write-Host "localhost:$Port -> ${wslIp}:$Port"
Write-Host "Log: $LogPath"
Write-Host "Web: http://localhost:$Port"
