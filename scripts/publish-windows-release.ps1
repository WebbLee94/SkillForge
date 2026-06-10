# Package and upload Windows installers to GitHub Releases.
param(
    [string]$Tag,
    [string]$Version,
    [string]$Arch = "x86_64",
    [string]$Repo = "WebbLee94/SkillForge",
    [switch]$ExeOnly,
    [switch]$RebuildNsis
)

$ErrorActionPreference = "Stop"

if ($RebuildNsis) {
    & "$PSScriptRoot\rebuild-nsis.ps1" -Version $Version
} else {
    & "$PSScriptRoot\package-windows-release.ps1" -Version $Version -Arch $Arch | Out-Null
}

& "$PSScriptRoot\upload-github-release.ps1" -Tag $Tag -Version $Version -Arch $Arch -Repo $Repo -ExeOnly:$ExeOnly -SkipPackage
