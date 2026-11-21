# Desinstala GitHelper. NO toca tus carpetas ni tus repositorios.
# Con -BorrarAjustes también elimina los ajustes guardados (%APPDATA%\GitHelper).
param([switch]$BorrarAjustes)
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:LOCALAPPDATA 'Programs\GitHelper'

# Si este script se está ejecutando desde la carpeta que vamos a borrar, se relanza desde una copia temporal.
if ($PSCommandPath -and $PSCommandPath.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase)) {
    $tmp = Join-Path $env:TEMP 'githelper-desinstalar.ps1'
    Copy-Item $PSCommandPath $tmp -Force
    $extra = if ($BorrarAjustes) { '-BorrarAjustes' } else { '' }
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tmp`" $extra" -Wait
    exit 0
}

Get-Process -Name 'GitHelper' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 600

Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\GitHelper.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'GitHelper.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GitHelper' -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
if ($BorrarAjustes) { Remove-Item (Join-Path $env:APPDATA 'GitHelper') -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output 'GitHelper desinstalado. Tus carpetas y repositorios no se han tocado.'
