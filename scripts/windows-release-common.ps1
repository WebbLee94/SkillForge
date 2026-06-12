# Shared helpers for Windows release scripts.
$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    return Split-Path $PSScriptRoot -Parent
}

function Get-AppVersion {
    param([string]$Root = (Get-ProjectRoot))
    $confPath = Join-Path $Root "src-tauri\tauri.conf.json"
    if (-not (Test-Path $confPath)) {
        throw "Missing $confPath"
    }
    return (Get-Content $confPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
}

function Get-VersionFromTag {
    param([string]$Tag)
    if ($Tag -match '^v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$') {
        return $Matches[1]
    }
    throw "Invalid tag '$Tag'. Expected format: v1.0.0 or 1.0.0"
}

function Ensure-CargoInPath {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path $cargoBin) {
        $env:Path = "$cargoBin;$env:Path"
    }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "cargo not found. Install Rust: https://rustup.rs"
    }
}

function Ensure-GhAuth {
    $null = Get-GhToken
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "gh CLI not found. Install: winget install GitHub.cli"
    }
}

function Get-TauriReleaseDir {
    param([string]$Root = (Get-ProjectRoot))
    $candidates = @(
        (Join-Path $Root "src-tauri\target\x86_64-pc-windows-gnu\release")
        (Join-Path $Root "src-tauri\target\x86_64-pc-windows-msvc\release")
        (Join-Path $Root "src-tauri\target\release")
    )
    foreach ($dir in $candidates) {
        if (Test-Path (Join-Path $dir "skillforge.exe")) {
            return $dir
        }
    }
    throw "Build first: npm run tauri build. No skillforge.exe under src-tauri\target\"
}

function Get-GhToken {
    if ($env:GH_TOKEN) { return $env:GH_TOKEN.Trim() }
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN.Trim() }

    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($gh) {
        $token = & gh auth token 2>$null
        if ($token) { return $token.Trim() }
    }

    $input = "protocol=https`nhost=github.com`n`n"
    $cred = ($input | git credential fill 2>$null | Out-String)
    foreach ($line in ($cred -split "`n")) {
        if ($line -like "password=*") {
            return $line.Substring(9).Trim()
        }
    }
    throw "No GitHub token. Run 'gh auth login' or set GH_TOKEN."
}

function Format-FileSize {
    param([long]$Bytes)
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N0} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}
