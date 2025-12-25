Set-StrictMode -Version Latest
$basedir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Use a deterministic path for the temporary NAVI used by the test
$temp = Join-Path $basedir '..\tmp_navi_deliver'
if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
New-Item -ItemType Directory -Path $temp -Force | Out-Null

# create package structure
$packages = Join-Path $temp 'packages'
New-Item -ItemType Directory -Path $packages -Force | Out-Null
$pkg = Join-Path $packages 'test_pkg'
New-Item -ItemType Directory -Path $pkg -Force | Out-Null

# create a sample file and sidecar
$f1 = Join-Path $pkg 'invoice1.pdf'
Set-Content -Path $f1 -Value 'PDF-DUMMY' -NoNewline

$n1 = $f1 + '.navi.json'
$side = @{ filename = 'invoice1.pdf'; route='finance'; applied_at = (Get-Date).ToString('o') }
$side | ConvertTo-Json -Depth 10 | Out-File -FilePath $n1 -Encoding utf8

# manifest.csv
$manifest = 'filename,route,applied_at' + "`n" + ('invoice1.pdf,finance,' + (Get-Date).ToString('o'))
$manifest | Out-File -FilePath (Join-Path $pkg 'manifest.csv') -Encoding utf8

$script = Resolve-Path (Join-Path $basedir '..\..\scripts\deliver-package.ps1')

Write-Host "Dry-run..."
& pwsh -NoProfile -ExecutionPolicy Bypass -File $script -PackageName 'test_pkg' -NaviRoot $temp

if (Test-Path (Join-Path $temp 'offices\finance\inbox\invoice1.pdf')) { Write-Error 'Dry-run moved files' ; exit 1 }

Write-Host "Apply..."
& pwsh -NoProfile -ExecutionPolicy Bypass -File $script -PackageName 'test_pkg' -NaviRoot $temp -Apply

$dest = Join-Path $temp 'offices\finance\inbox\invoice1.pdf'
if (-not (Test-Path $dest)) { Write-Error "Destination missing: $dest" ; exit 1 }

$destNavi = $dest + '.navi.json'
if (-not (Test-Path $destNavi)) { Write-Error "Missing dest sidecar" ; exit 1 }
$jn = Get-Content $destNavi -Raw | ConvertFrom-Json
if (-not $jn.delivered) { Write-Error "Delivered flag not set"; exit 1 }

$audit = Join-Path $temp 'approvals\audit.log'
if (-not (Test-Path $audit)) { Write-Error "Missing audit.log"; exit 1 }
$content = Get-Content $audit -Raw
if ($content -notmatch 'deliver_file') { Write-Error "No deliver_file audit entry"; exit 1 }

Write-Host "TESTS PASSED"
# cleanup
Remove-Item -Recurse -Force $temp
exit 0