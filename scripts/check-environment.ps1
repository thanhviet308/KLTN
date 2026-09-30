$ErrorActionPreference = 'Continue'

function Show-Version {
    param([string]$Name, [string[]]$VersionArgs = @('--version'))
    if (Get-Command $Name -ErrorAction SilentlyContinue) {
        Write-Output "[FOUND] $Name"
        & $Name @VersionArgs 2>&1 | ForEach-Object { Write-Output "  $_" }
    } else {
        Write-Output "[MISSING FROM PATH] $Name"
    }
}

Show-Version 'node'
Show-Version 'npm.cmd'
Show-Version 'git'
Show-Version 'docker'
Show-Version 'java' @('-version')
Show-Version 'adb' @('version')

if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker compose version 2>&1
    $engineVersion = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Output "[READY] Docker Engine $engineVersion"
    } else {
        Write-Output '[NOT READY] Docker Engine is unavailable to this shell.'
    }
}

$sdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)
if ($env:LOCALAPPDATA) {
    $sdkCandidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
foreach ($sdkPath in ($sdkCandidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $sdkPath) {
        Write-Output "[FOUND] Android SDK directory: $sdkPath"
        foreach ($component in @('platform-tools\adb.exe', 'platforms', 'build-tools', 'emulator\emulator.exe')) {
            $componentPath = Join-Path $sdkPath $component
            Write-Output "  $component : $(Test-Path -LiteralPath $componentPath)"
        }
    } else {
        Write-Output "[MISSING] Android SDK directory: $sdkPath"
    }
}
Write-Output 'Read-only check complete. App builds and SDK compatibility are not verified.'
