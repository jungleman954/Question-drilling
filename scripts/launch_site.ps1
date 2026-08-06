param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$siteUrl = 'http://localhost:5173/'

function Test-SiteRunning {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $siteUrl -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

if ($Check) {
    if (Test-SiteRunning) { exit 0 }
    exit 1
}

if (-not (Test-SiteRunning)) {
    $runner = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    $runnerArguments = 'dev'

    if (-not $runner) {
        $runner = Get-Command npm.cmd -ErrorAction SilentlyContinue
        $runnerArguments = 'run dev'
    }

    if (-not $runner) {
        Write-Host ''
        Write-Host 'Node.js npm or pnpm was not found.' -ForegroundColor Red
        Write-Host 'Install Node.js, then double-click the launcher again.'
        Read-Host 'Press Enter to close'
        exit 1
    }

    $quotedRunner = '"' + $runner.Source + '"'
    $commandLine = "$quotedRunner $runnerArguments"
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList @('/d', '/c', $commandLine) `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden

    $started = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        if (Test-SiteRunning) {
            $started = $true
            break
        }
    }

    if (-not $started) {
        Write-Host ''
        Write-Host 'The website did not start in time. Make sure dependencies are installed.' -ForegroundColor Red
        Read-Host 'Press Enter to close'
        exit 1
    }
}

Start-Process $siteUrl
