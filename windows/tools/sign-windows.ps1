param([Parameter(Mandatory=$true)][string]$CertificateThumbprint,[Parameter(Mandatory=$true)][string]$ExpectedPublisher)
$ErrorActionPreference='Stop'
$signTool=(Get-Command signtool.exe -ErrorAction Stop).Source
$root=Split-Path -Parent $PSScriptRoot
$manifest=Get-Content -LiteralPath (Join-Path $root 'WINDOWS-BUILDS.json') -Raw | ConvertFrom-Json
foreach($build in $manifest.builds){
 $executable=Join-Path $root $build.executable
 & $signTool sign /sha1 $CertificateThumbprint /fd SHA256 /tr 'http://timestamp.digicert.com' /td SHA256 $executable
 if($LASTEXITCODE -ne 0){throw 'Publisher signing failed.'}
 $signature=Get-AuthenticodeSignature -LiteralPath $executable
 if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -ne $ExpectedPublisher){throw 'Publisher signature validation failed.'}
}
Write-Output 'Publisher signatures applied. Re-run packaged verification and regenerate the release checksum inventory for these exact signed binaries.'
