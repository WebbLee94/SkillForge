# Upload Windows release artifacts to GitHub Releases (one file at a time, with progress).
param(
    [string]$Tag,
    [string]$Version,
    [string]$Arch = "x86_64",
    [string]$Repo = "WebbLee94/SkillForge",
    [switch]$ExeOnly,
    [switch]$SkipPackage
)

. "$PSScriptRoot\windows-release-common.ps1"

$root = Get-ProjectRoot
if (-not $Version) { $Version = Get-AppVersion }
if (-not $Tag) { $Tag = "v$Version" }

$dist = Join-Path $root "dist"
$exeAsset = Join-Path $dist "SkillForge_${Version}_${Arch}.exe"
$msiAsset = Join-Path $dist "SkillForge_${Version}_${Arch}.msi"

if (-not $SkipPackage) {
    Write-Host "Packaging dist artifacts ..."
    & "$PSScriptRoot\package-windows-release.ps1" -Version $Version -Arch $Arch | Out-Null
}

if (-not (Test-Path $exeAsset)) {
    throw "Missing $exeAsset. Build and package first."
}

$files = @($exeAsset)
if (-not $ExeOnly) {
    if (Test-Path $msiAsset) {
        $files += $msiAsset
    } else {
        Write-Warning "MSI not found, uploading exe only. Use -ExeOnly to silence this warning."
    }
}

$token = Get-GhToken
$env:GH_TOKEN = $token

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { throw "gh CLI not found. Install: winget install GitHub.cli" }

Write-Host "Uploading to $Repo release $Tag ..."
$sw = [Diagnostics.Stopwatch]::StartNew()

foreach ($i in 0..($files.Count - 1)) {
    $file = $files[$i]
    $item = Get-Item $file
    $n = $i + 1
    Write-Host "[$n/$($files.Count)] $($item.Name) ($(Format-FileSize $item.Length)) ..."
    $fileSw = [Diagnostics.Stopwatch]::StartNew()
    & gh release upload $Tag $file --repo $Repo --clobber
    if ($LASTEXITCODE -ne 0) { throw "gh release upload failed for $($item.Name) (exit $LASTEXITCODE)" }
    $fileSw.Stop()
    Write-Host "  done in $($fileSw.Elapsed.TotalSeconds.ToString('0.0'))s"
}

$sw.Stop()
Write-Host "All uploads finished in $($sw.Elapsed.TotalSeconds.ToString('0.0'))s"
Write-Host "Release: https://github.com/$Repo/releases/tag/$Tag"
