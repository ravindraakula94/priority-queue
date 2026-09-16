param([switch]$NoBundle, [switch]$SelfSign)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
$cargoDirectory = Join-Path $env:USERPROFILE '.cargo/bin'
$env:Path = "$nodeDirectory;$cargoDirectory;" + $env:Path
Push-Location $root
try {
    $arguments = @('run', 'desktop:build', '--')
    $signingThumbprint = $null
    if ($NoBundle) { $arguments += '--no-bundle' }
    if ($SelfSign) {
        $signingConfiguration = Join-Path $root '.signing/tauri.windows.json'
        if (!(Test-Path $signingConfiguration)) { throw 'Run scripts/Initialize-SelfSigning.ps1 before building with -SelfSign.' }
        $signing = Get-Content $signingConfiguration -Raw | ConvertFrom-Json
        $signingThumbprint = $signing.bundle.windows.certificateThumbprint
        if ($signingThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid local signing certificate thumbprint.' }
        $certificate = Get-Item ('Cert:\CurrentUser\My\' + $signingThumbprint) -ErrorAction Stop
        if (!$certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'The signing certificate is expired, not yet valid, or has no private key.' }
        if ('1.3.6.1.5.5.7.3.3' -notin $certificate.EnhancedKeyUsageList.ObjectId) { throw 'The certificate is not permitted for code signing.' }
        $arguments += @('--config', $signingConfiguration)
        Write-Host 'Self-signing with the local Windows identity. Other PCs will not automatically trust this publisher.'
    }
    if (!(Test-Path 'src-tauri/icons/icon.ico')) { & "$PSScriptRoot/Generate-Icon.ps1" }
    & npm.cmd @arguments
    if ($LASTEXITCODE -ne 0) { throw "Desktop build failed with exit code $LASTEXITCODE" }
    $artifacts = @()
    if ($NoBundle) {
        if ($SelfSign) {
            $signTool = Get-ChildItem (Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Windows Kits/10/bin/*/x64/signtool.exe') | Sort-Object FullName -Descending | Select-Object -First 1
            if (!$signTool) { throw 'Windows SDK SignTool is required to sign the executable.' }
            & $signTool.FullName sign /fd sha256 /sha1 $signingThumbprint /s My /tr $signing.bundle.windows.timestampUrl /td sha256 'src-tauri/target/release/priority-queue.exe'
            if ($LASTEXITCODE -ne 0) { throw 'Executable signing failed.' }
        }
        $artifacts += Get-Item 'src-tauri/target/release/priority-queue.exe'
        Write-Host 'Development executable only. Run without -NoBundle to build the release installer.'
        Get-Item 'src-tauri/target/release/priority-queue.exe' | Select-Object FullName, @{Name='SizeMB'; Expression={ [math]::Round($_.Length / 1MB, 2) }} | Format-List
    } else {
        $version = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
        $installers = @(Get-ChildItem "src-tauri/target/release/bundle/nsis/*_${version}_*-setup.exe")
        if (!$installers.Count) { throw "No release installer was produced for version $version." }
        $artifacts += $installers
        Write-Host 'Release assets: publish the setup installer and LICENSE, not the internal app executable.'
        $installers | Select-Object FullName, @{Name='SizeMB'; Expression={ [math]::Round($_.Length / 1MB, 2) }} | Format-List
        $installers | Get-FileHash -Algorithm SHA256 | Format-List
    }
    if ($SelfSign) {
        foreach ($artifact in $artifacts) {
            $signature = Get-AuthenticodeSignature $artifact.FullName
            if ($signature.SignerCertificate.Thumbprint -ne $signingThumbprint -or $signature.Status -in @('NotSigned', 'HashMismatch', 'NotSupported', 'Incompatible')) { throw "Missing or invalid signature on $($artifact.FullName)." }
            if (!$signature.TimeStamperCertificate) { throw "Missing timestamp on $($artifact.FullName)." }
            $signature | Select-Object Path, Status, StatusMessage, @{Name='Signer'; Expression={ $_.SignerCertificate.Subject }} | Format-List
        }
        Write-Host 'Signing and timestamping completed. An untrusted-root status is expected until this certificate is explicitly trusted.'
        if (!$NoBundle) { Write-Host 'Tauri signs the packaged app and uninstaller, then restores the unsigned intermediate target/release executable.' }
        Get-FileHash '.signing/PriorityQueue-SelfSigned.cer' -Algorithm SHA256 | Format-List
    }
} finally {
    Pop-Location
}