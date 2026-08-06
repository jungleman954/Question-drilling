param(
    [Parameter(Mandatory = $true)]
    [string]$DistDir,
    [Parameter(Mandatory = $true)]
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$distPath = [System.IO.Path]::GetFullPath($DistDir)
$outputPath = [System.IO.Path]::GetFullPath($OutputDir)

if (Test-Path -LiteralPath $outputPath) {
    throw "Output directory already exists: $outputPath"
}

$javascriptFile = Get-ChildItem -LiteralPath (Join-Path $distPath 'assets') -Filter '*.js' | Select-Object -First 1
$stylesheetFile = Get-ChildItem -LiteralPath (Join-Path $distPath 'assets') -Filter '*.css' | Select-Object -First 1

if (-not $javascriptFile -or -not $stylesheetFile) {
    throw 'Built JavaScript or CSS asset was not found.'
}

$questions = Get-Content -Raw -Encoding UTF8 (Join-Path $distPath 'questions.json') | ConvertFrom-Json
foreach ($question in $questions) {
    $question.images = @($question.images | ForEach-Object { $_.Replace('/question-images/', './question-images/') })
}

$questionsJson = ($questions | ConvertTo-Json -Depth 12 -Compress).Replace('</script', '<\/script')
$stylesheet = (Get-Content -Raw -Encoding UTF8 $stylesheetFile.FullName).Replace('</style', '<\/style')
$javascript = (Get-Content -Raw -Encoding UTF8 $javascriptFile.FullName).Replace('</script', '<\/script')

$fetchBridge = @"
window.__QUESTION_BANK__ = $questionsJson;
const __nativeFetch = window.fetch ? window.fetch.bind(window) : null;
window.fetch = function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
  if (url.endsWith('/questions.json') || url === 'questions.json' || url === './questions.json') {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function() { return Promise.resolve(window.__QUESTION_BANK__); }
    });
  }
  return __nativeFetch(input, init);
};
"@

$html = @"
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#264c3f" />
    <title>Question Bank</title>
    <style>$stylesheet</style>
  </head>
  <body>
    <div id="root"></div>
    <script>$fetchBridge</script>
    <script>$javascript</script>
  </body>
</html>
"@

New-Item -ItemType Directory -Path $outputPath | Out-Null
Copy-Item -LiteralPath (Join-Path $distPath 'question-images') -Destination (Join-Path $outputPath 'question-images') -Recurse
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $outputPath 'Open-Question-Bank.html'), $html, $utf8)
