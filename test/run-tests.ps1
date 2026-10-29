# Runs test/index.html in headless Chrome (or Edge) and prints the results.
# Usage (from the link-saver folder):  powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
# Exit code is 0 when every test passes, 1 otherwise.
param(
  [string]$Browser = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Browser) {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  $Browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if (-not $Browser) {
  Write-Error 'Chrome or Edge not found. Pass its path with -Browser "C:\path\to\chrome.exe", or open test\index.html in a browser.'
}

$page = (Resolve-Path (Join-Path $PSScriptRoot 'index.html')).Path
$url = 'file:///' + ($page -replace '\\', '/' -replace ' ', '%20')
# A throwaway profile so this never touches (or waits on) your normal browser window.
$profile = Join-Path ([System.IO.Path]::GetTempPath()) ("link-saver-tests-" + [guid]::NewGuid())

try {
  # Chrome logs harmless noise to stderr; Windows PowerShell would treat that as a fatal error.
  $ErrorActionPreference = 'Continue'
  $dom =& $Browser --headless=new --disable-gpu --no-first-run --no-default-browser-check `
    "--user-data-dir=$profile" --virtual-time-budget=60000 --dump-dom $url 2>$null | Out-String
} finally {
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
}

if ($dom -notmatch '<p id="summary"[^>]*>([^<]*)</p>') {
  Write-Host 'Could not read test results from the page.' -ForegroundColor Red
  exit 1
}
$summary = $Matches[1]

[regex]::Matches($dom, '<li class="(pass|fail)">([^<]*)</li>') | ForEach-Object {
  $color = if ($_.Groups[1].Value -eq 'pass') { 'Green' } else { 'Red' }
  Write-Host ([System.Net.WebUtility]::HtmlDecode($_.Groups[2].Value)) -ForegroundColor $color
}
Write-Host ''
if ($summary -like 'PASS*') {
  Write-Host $summary -ForegroundColor Green
  exit 0
}
Write-Host $summary -ForegroundColor Red
exit 1
