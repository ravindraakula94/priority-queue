param([string]$Installer)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$configuration = Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
if (!$Installer) {
    $Installer = (Get-ChildItem (Join-Path $root "src-tauri/target/release/bundle/nsis/*_$($configuration.version)_*-setup.exe") | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (!$Installer -or !(Test-Path $Installer)) { throw 'Build the release installer first.' }
$Installer = (Resolve-Path $Installer).Path
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Priority Queue'
$productKey = 'HKCU:\Software\priorityqueue\Priority Queue'
$runKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path $uninstallKey) { throw 'An installed Priority Queue already exists. Use a clean Windows test profile for installer smoke tests.' }
if (Get-Process -Name priority-queue -ErrorAction SilentlyContinue) { throw 'Close Priority Queue before testing its installer.' }
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('priority-queue-installer-' + [guid]::NewGuid())
$installDirectory = Join-Path $temporaryDirectory 'Priority Queue'
$executable = Join-Path $installDirectory 'priority-queue.exe'
$uninstaller = Join-Path $installDirectory 'uninstall.exe'
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
$registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($runKey)
$originalStartup = $registry.GetValue('Priority Queue')
$originalKind = if ($null -ne $originalStartup) { $registry.GetValueKind('Priority Queue') }
$productBackup = Join-Path $temporaryDirectory 'product.reg'
if (Test-Path $productKey) {
    & reg.exe export 'HKCU\Software\priorityqueue\Priority Queue' $productBackup /y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not back up installer registration.' }
}
function DataHash([string]$Path) {
    if (Test-Path $Path) { return (Get-FileHash $Path -Algorithm SHA256).Hash }
    return '<missing>'
}
$dataBefore = @{}
foreach ($file in @('queue.json', 'preferences.json')) {
    $path = Join-Path $env:APPDATA "com.priorityqueue.desktop/$file"
    $dataBefore[$path] = DataHash $path
}
function Install-TestApp([bool]$Update) {
    $arguments = if ($Update) { "/S /NS /UPDATE /D=$installDirectory" } else { "/S /NS /D=$installDirectory" }
    $process = Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru -Wait
    if ($process.ExitCode -ne 0 -or !(Test-Path $executable)) { throw 'Installer failed.' }
}
function Uninstall-TestApp([bool]$Update) {
    $arguments = if ($Update) { "/S /UPDATE _?=$installDirectory" } else { "/S _?=$installDirectory" }
    $process = Start-Process -FilePath $uninstaller -ArgumentList $arguments -PassThru -Wait
    if ($process.ExitCode -ne 0 -or (Test-Path $executable)) { throw 'Uninstaller failed.' }
}
try {
    Install-TestApp $false
    & (Join-Path $env:ProgramFiles 'nodejs/node.exe') (Join-Path $PSScriptRoot 'Smoke-Desktop.mjs') $executable
    if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke test failed.' }
    $startupCommand = '"' + $executable + '"'
    $registry.SetValue('Priority Queue', $startupCommand)
    Install-TestApp $true
    if ($registry.GetValue('Priority Queue') -ne $startupCommand) { throw 'Update changed startup registration.' }
    Uninstall-TestApp $true
    if ($registry.GetValue('Priority Queue') -ne $startupCommand) { throw 'Update uninstall removed startup registration.' }
    Install-TestApp $false
    Uninstall-TestApp $false
    if ($null -ne $registry.GetValue('Priority Queue')) { throw 'Uninstall left a startup entry.' }
    if (Test-Path $uninstallKey) { throw 'Uninstall left its installed-app registration.' }
    foreach ($path in $dataBefore.Keys) {
        if ((DataHash $path) -ne $dataBefore[$path]) { throw "The installer test changed app data: $path" }
    }
    Write-Host 'Installer smoke test passed: install, installed-app onboarding/autostart, update-mode preservation, uninstall cleanup, and unchanged user data.'
} finally {
    try {
        if ((Test-Path $uninstaller) -and (Test-Path $executable)) { Uninstall-TestApp $false }
    } finally {
        if ($null -eq $originalStartup) { $registry.DeleteValue('Priority Queue', $false) }
        else { $registry.SetValue('Priority Queue', $originalStartup, $originalKind) }
        $registry.Close()
        if (Test-Path $productKey) { Remove-Item $productKey -Recurse -Force }
        if (Test-Path $productBackup) {
            & reg.exe import $productBackup | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Could not restore installer registration from $productBackup" }
        }
        Remove-Item $temporaryDirectory -Recurse -Force
    }
}