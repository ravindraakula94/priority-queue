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
    if ($NoBundle) {
        Write-Host 'Development executable only. Run without -NoBundle to build the release installer.'
        Get-Item 'src-tauri/target/release/priority-queue.exe' | Select-Object FullName, @{Name='SizeMB'; Expression={ [math]::Round($_.Length / 1MB, 2) }} | Format-List
    } else {
        $version = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
        $installers = @(Get-ChildItem "src-tauri/target/release/bundle/nsis/*_${version}_*-setup.exe")
        if (!$installers.Count) { throw "No release installer was produced for version $version." }
        Write-Host 'Release assets: publish the setup installer and LICENSE, not the internal app executable.'
        $installers | Select-Object FullName, @{Name='SizeMB'; Expression={ [math]::Round($_.Length / 1MB, 2) }} | Format-List
        $installers | Get-FileHash -Algorithm SHA256 | Format-List
    }
} finally {
    Pop-Location
}