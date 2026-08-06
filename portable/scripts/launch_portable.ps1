param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $packageRoot 'app'
$serverScript = Join-Path $PSScriptRoot 'serve_portable.ps1'
$port = 5173
$siteUrl = "http://127.0.0.1:$port/"

function Test-QuestionBankSite {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri ($siteUrl + 'questions.json') -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('q-0001')
    }
    catch {
        return $false
    }
}

if ($Check) {
    if (Test-QuestionBankSite) { exit 0 }
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'index.html'))) {
    Write-Host ''
    Write-Host 'The app files are missing. Extract the complete ZIP package first.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

if (-not (Test-QuestionBankSite)) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$serverScript`" -Root `"$appRoot`" -Port $port"
    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList $arguments `
        -WorkingDirectory $packageRoot `
        -WindowStyle Hidden

    $started = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        if (Test-QuestionBankSite) {
            $started = $true
            break
        }
    }

    if (-not $started) {
        Write-Host ''
        Write-Host 'The local website could not start. Port 5173 may already be in use.' -ForegroundColor Red
        Read-Host 'Press Enter to close'
        exit 1
    }
}

Start-Process $siteUrl
