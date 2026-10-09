param([string]$Image = 'pingpong-api:sharp-v1-experiment', [string]$OutputName = '.sharp-vps-transfer')
$ErrorActionPreference = 'Stop'
function Invoke-Docker {
    param([string[]]$DockerArguments)
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($DockerArguments -join ' ')" }
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ($OutputName -notmatch '^\.sharp-vps-transfer(-[A-Za-z0-9_-]+)?$') { throw 'OutputName must be a transfer directory name inside the repository.' }
$output = Join-Path $repo $OutputName
if (Test-Path -LiteralPath $output) { throw 'Transfer directory already exists. Preserve or rename it before exporting another image.' }
$platform = Invoke-Docker @('image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', $Image)
if ($platform -ne 'linux/amd64') { throw 'Expected a linux/amd64 image.' }
$imageId = Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', $Image)
if ($imageId -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Invalid image ID.' }
Invoke-Docker @('run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1', $imageId, 'node', 'apps/api/tests/sharp-runtime-smoke.cjs', '--source')
Invoke-Docker @('run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1', $imageId, 'node', 'apps/api/tests/api-runtime-dependencies.cjs')
$tag = "pingpong-api:sharp-v1-$($imageId.Substring(7))"
Invoke-Docker @('image', 'tag', $imageId, $tag)
New-Item -ItemType Directory -Path $output | Out-Null
Invoke-Docker @('image', 'save', '--output', (Join-Path $output 'image.tar'), $tag)
[IO.File]::WriteAllText((Join-Path $output 'image-tag.txt'), "$tag`n", [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $output 'source-image-id.txt'), "$imageId`n", [Text.Encoding]::ASCII)
foreach ($file in @('compose.sharp-test.yml', 'compose.sharp-staging.yml', 'sharp-vps-validation.md', 'sharp-runtime-fix.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $output
}
$entries = Get-ChildItem -LiteralPath $output -File | Sort-Object Name | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
}
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), (($entries -join "`n") + "`n"), [Text.Encoding]::ASCII)
Write-Host "Transfer ready: $output"
Write-Host "Pinned tag: $tag"
Write-Host 'No upload or deployment was performed.'
