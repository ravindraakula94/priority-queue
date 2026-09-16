param([string]$SevenZip = (Join-Path $env:ProgramFiles '7-Zip/7z.exe'))

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (!(Test-Path $SevenZip)) { throw '7-Zip is required to inspect the installer without installing it. Supply its path with -SevenZip.' }
$configuration = Get-Content (Join-Path $root '.signing/tauri.windows.json') -Raw | ConvertFrom-Json
$thumbprint = $configuration.bundle.windows.certificateThumbprint
$version = (Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
$installers = @(Get-ChildItem (Join-Path $root "src-tauri/target/release/bundle/nsis/*_${version}_*-setup.exe"))
if ($installers.Count -ne 1) { throw 'Expected exactly one installer matching the current version.' }
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('priority-queue-signatures-' + [guid]::NewGuid())
$trustBefore = @{}
foreach ($store in @('Root', 'TrustedPublisher')) {
    $trustBefore[$store] = Test-Path "Cert:\CurrentUser\$store\$thumbprint"
}
try {
    & $SevenZip x $installers[0].FullName ('-o' + $temporaryDirectory) -y -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract installer contents.' }
    $apps = @(Get-ChildItem $temporaryDirectory -Filter 'priority-queue.exe' -Recurse)
    $uninstallers = @(Get-ChildItem $temporaryDirectory -Filter 'uninstall.exe' -Recurse)
    if ($apps.Count -ne 1 -or $uninstallers.Count -ne 1) { throw 'Could not identify the packaged app and uninstaller.' }
    foreach ($artifact in @($installers[0], $apps[0], $uninstallers[0])) {
        $signature = Get-AuthenticodeSignature $artifact.FullName
        if ($signature.SignerCertificate.Thumbprint -ne $thumbprint) { throw "Wrong or missing signer on $($artifact.Name)." }
        if (!$signature.TimeStamperCertificate) { throw "Missing timestamp on $($artifact.Name)." }
        if ($signature.Status -in @('NotSigned', 'HashMismatch', 'NotSupported', 'Incompatible')) { throw "Invalid signature on $($artifact.Name): $($signature.Status)." }
        $signature | Select-Object Path, Status, StatusMessage, @{Name='Signer'; Expression={ $_.SignerCertificate.Subject }}, @{Name='Timestamp'; Expression={ $_.TimeStamperCertificate.Subject }} | Format-List
    }
    $tampered = Join-Path $temporaryDirectory 'tampered.exe'
    $bytes = [IO.File]::ReadAllBytes($apps[0].FullName)
    $bytes[96] = $bytes[96] -bxor 1
    [IO.File]::WriteAllBytes($tampered, $bytes)
    $tamperedSignature = Get-AuthenticodeSignature $tampered
    if ($tamperedSignature.Status -ne 'HashMismatch') { throw "Tamper test did not report HashMismatch: $($tamperedSignature.Status)." }
    foreach ($store in $trustBefore.Keys) {
        if ((Test-Path "Cert:\CurrentUser\$store\$thumbprint") -ne $trustBefore[$store]) { throw 'Certificate trust changed during verification.' }
    }
    Write-Host 'Self-signing test passed: installer, packaged app and uninstaller have the expected signer and timestamp; tampering is detected. Nothing was installed or trusted.'
} finally {
    if (Test-Path $temporaryDirectory) { Remove-Item $temporaryDirectory -Recurse -Force }
}