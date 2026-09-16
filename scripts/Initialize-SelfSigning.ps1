param([string]$Subject = 'CN=Ravindra Akula', [switch]$Rotate)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$signingDirectory = Join-Path $root '.signing'
$configurationPath = Join-Path $signingDirectory 'tauri.windows.json'
$publicCertificatePath = Join-Path $signingDirectory 'PriorityQueue-SelfSigned.cer'
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('My', 'CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$key = $null
$rsa = $null
$certificate = $null
try {
    if ($Rotate -and (Test-Path $configurationPath)) {
        $backupDirectory = Join-Path $signingDirectory ('previous-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path $backupDirectory | Out-Null
        Copy-Item $configurationPath $backupDirectory
        if (Test-Path $publicCertificatePath) { Copy-Item $publicCertificatePath $backupDirectory }
        Write-Host ('Previous public signing configuration retained in ' + $backupDirectory)
    }
    if ((Test-Path $configurationPath) -and !$Rotate) {
        $configuration = Get-Content $configurationPath -Raw | ConvertFrom-Json
        $thumbprint = $configuration.bundle.windows.certificateThumbprint
        $certificate = $store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint } | Select-Object -First 1
        if (!$certificate -or !$certificate.HasPrivateKey) { throw 'The configured signing certificate or private key is missing from this Windows account.' }
        if ($certificate.Subject -ne $Subject) { throw 'The configured certificate has a different subject. Use -Rotate to explicitly create a new identity while retaining the previous certificate.' }
        if ($certificate.NotAfter -le (Get-Date).AddDays(30)) { throw 'The signing certificate expires within 30 days. Renew it explicitly before signing a release.' }
    } else {
        $parameters = [System.Security.Cryptography.CngKeyCreationParameters]::new()
        $parameters.Provider = [System.Security.Cryptography.CngProvider]::MicrosoftSoftwareKeyStorageProvider
        $parameters.KeyUsage = [System.Security.Cryptography.CngKeyUsages]::Signing
        $parameters.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
        $parameters.Parameters.Add([System.Security.Cryptography.CngProperty]::new('Length', [BitConverter]::GetBytes(3072), [System.Security.Cryptography.CngPropertyOptions]::None))
        $key = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, ('PriorityQueue-SelfSigning-' + [guid]::NewGuid()), $parameters)
        $rsa = [System.Security.Cryptography.RSACng]::new($key)
        $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new($Subject, $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
        $usages = [System.Security.Cryptography.OidCollection]::new()
        $usages.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usages, $true))
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($request.PublicKey, $false))
        $certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddYears(2))
        $certificate.FriendlyName = 'Priority Queue self-signed code signing'
        $store.Add($certificate)
    }
    New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
    [System.IO.File]::WriteAllBytes($publicCertificatePath, $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    $configuration = @{ bundle = @{ windows = @{ certificateThumbprint = $certificate.Thumbprint; digestAlgorithm = 'sha256'; timestampUrl = 'http://timestamp.digicert.com'; tsp = $true } } }
    $configuration | ConvertTo-Json -Depth 5 | Set-Content -Path $configurationPath -Encoding utf8
    [pscustomobject]@{
        Subject = $certificate.Subject
        Thumbprint = $certificate.Thumbprint
        Expires = $certificate.NotAfter
        PrivateKeyLocation = 'Cert:\CurrentUser\My (non-exportable software key)'
        PublicCertificate = $publicCertificatePath
        Configuration = $configurationPath
    } | Format-List
    Write-Host 'Self-signing is configured. No Windows trust stores were changed.'
} finally {
    if ($certificate) { $certificate.Dispose() }
    if ($rsa) { $rsa.Dispose() }
    if ($key) { $key.Dispose() }
    $store.Close()
}