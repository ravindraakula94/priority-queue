param([switch]$NoBundle)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
$cargoDirectory = Join-Path $env:USERPROFILE '.cargo/bin'
$env:Path = "$nodeDirectory;$cargoDirectory;" + $env:Path
Push-Location $root
try {
    if (!(Test-Path 'src-tauri/icons/icon.ico')) { & "$PSScriptRoot/Generate-Icon.ps1" }
    if ($NoBundle) { & npm.cmd run desktop:build -- --no-bundle }
    else { & npm.cmd run desktop:build }
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE" }
    Get-Item 'src-tauri/target/release/priority-queue.exe' | Select-Object FullName, @{Name='SizeMB'; Expression={ [math]::Round($_.Length / 1MB, 2) }} | Format-List
    if (!$NoBundle) { Get-ChildItem 'src-tauri/target/release/bundle/nsis/*-setup.exe' | Select-Object FullName, @{Name='SizeMB'; Expression={ [math]::Round($_.Length / 1MB, 2) }} | Format-List }
} finally {
    Pop-Location
}