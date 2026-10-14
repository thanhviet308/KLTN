param(
    [Parameter(Mandatory = $true)][string]$OldImage,
    [string]$NewImage = 'pingpong-api:blue-green-validation'
)
# Local-only integration: fresh PostgreSQL, separate ports/volumes and secrets.
$ErrorActionPreference = 'Stop'
function Run-Docker {
    param([string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker failed: $($Arguments -join ' ')" }
}
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$env:SHARP_TEST_IMAGE = Run-Docker @('image', 'inspect', '--format', '{{.Id}}', $NewImage)
$env:STAGING_BLUE_IMAGE = Run-Docker @('image', 'inspect', '--format', '{{.Id}}', $OldImage)
$env:STAGING_POSTGRES_IMAGE = Run-Docker @('image', 'inspect', '--format', '{{.Id}}', 'postgres:17-bookworm')
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
foreach ($setting in @(@('STAGING_DB_PASSWORD', 24), @('STAGING_JWT_SECRET', 32))) {
    $bytes = New-Object byte[] $setting[1]
    $rng.GetBytes($bytes)
    Set-Item -Path ('Env:' + $setting[0]) -Value ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
}
$rng.Dispose()
$overlay = New-TemporaryFile
$sourceCompose = (Join-Path $PWD 'deploy/vps/compose.sharp-staging.yml').Replace('\', '/')
$text = @'
services:
  staging-api:
    image: ${STAGING_BLUE_IMAGE:?}
    ports: !override ['127.0.0.1:13100:3000']
  staging-green:
    extends:
      file: 'COMPOSE_FILE'
      service: staging-api
    environment:
      DEPLOYMENT_REVISION: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    ports: !override ['127.0.0.1:13101:3000']
'@
[IO.File]::WriteAllText($overlay.FullName, $text.Replace('COMPOSE_FILE', $sourceCompose), (New-Object Text.UTF8Encoding($false)))
$project = 'pingpong-bg-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$compose = @('compose', '-p', $project, '-f', 'deploy/vps/compose.sharp-staging.yml', '-f', $overlay.FullName)
$query = "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public'), (SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension);"
try {
    Run-Docker ($compose + @('config', '--quiet'))
    Run-Docker ($compose + @('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'staging-db'))
    $before = Run-Docker ($compose + @('exec', '-T', 'staging-db', 'psql', '-U', 'pingpong_staging', '-d', 'pingpong_staging', '-At', '-c', $query))
    & docker @compose run --rm -T --no-deps staging-migrate node apps/api/dist/modules/database/migrate.js --check
    if ($LASTEXITCODE -ne 1) { throw 'Pending migration check must reject the fresh schema' }
    $after = Run-Docker ($compose + @('exec', '-T', 'staging-db', 'psql', '-U', 'pingpong_staging', '-d', 'pingpong_staging', '-At', '-c', $query))
    if ($before -ne $after) { throw 'Check-only changed tables/extensions' }
    Write-Host "Read-only check preserved tables/extensions: $after"
    Run-Docker ($compose + @('run', '--rm', '-T', '--no-deps', 'staging-migrate'))
    Run-Docker ($compose + @('run', '--rm', '-T', '--no-deps', 'staging-migrate', 'node', 'apps/api/dist/modules/database/migrate.js', '--check'))
    Run-Docker ($compose + @('up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '120', 'staging-api', 'staging-green'))
    foreach ($service in @('staging-api', 'staging-green')) {
        Run-Docker ($compose + @('exec', '-T', $service, 'node', 'apps/api/tests/api-runtime-health.cjs'))
    }
    foreach ($port in @(13100, 13101)) {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health/ready" -TimeoutSec 10
        if ($response.status -ne 'ok') { throw 'Host readiness failed' }
    }
    $greenResponse = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:13101/api/v1/health/ready' -TimeoutSec 10
    if ($greenResponse.Headers['X-PingPong-Revision'] -ne ('a' * 40)) { throw 'Candidate revision header missing' }
    Run-Docker ($compose + @('stop', '-t', '15', 'staging-api'))
    Run-Docker ($compose + @('exec', '-T', 'staging-green', 'node', 'apps/api/tests/api-runtime-health.cjs'))
    Write-Host "Two versions share staging DB safely; Green stays healthy after Blue stops ($project)"
} finally {
    & docker @compose stop -t 15 staging-api staging-green staging-db
    Remove-Item -LiteralPath $overlay.FullName -Force
    Write-Host "Staging stopped; volumes preserved ($project)"
}
