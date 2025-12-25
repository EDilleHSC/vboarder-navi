# Requires PowerShell Core or Windows PowerShell with appropriate execution policy
$script = Join-Path (Get-Location) 'scripts\package_routed_files.ps1'
$testDir = Join-Path (Get-Location) 'tests\temp_pkg_test'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $testDir
New-Item -ItemType Directory -Path $testDir | Out-Null

# Create route folder with sample files
$routeDir = Join-Path $testDir 'route'
New-Item -ItemType Directory -Path $routeDir | Out-Null

# 1) Normal .navi.json object
$file1 = Join-Path $routeDir 'doc1.pdf'
Set-Content -Path $file1 -Value 'PDFDATA'
$n1 = Join-Path $routeDir 'doc1.pdf.navi.json'
@{ route='mail_room.review_required'; extracted_text_snippet='hello' } | ConvertTo-Json -Depth 5 | Set-Content -Path $n1

# 2) .navi.json is a primitive (string)
$file2 = Join-Path $routeDir 'doc2.pdf'
Set-Content -Path $file2 -Value 'PDFDATA'
$n2 = Join-Path $routeDir 'doc2.pdf.navi.json'
'just a string' | Set-Content -Path $n2

# 3) .navi.json is an array
$file3 = Join-Path $routeDir 'doc3.pdf'
Set-Content -Path $file3 -Value 'PDFDATA'
$n3 = Join-Path $routeDir 'doc3.pdf.navi.json'
@('a','b','c') | ConvertTo-Json | Set-Content -Path $n3

# Run packager against routeDir
$packagesRoot = Join-Path $testDir 'packages'
& $script -RouteFolder $routeDir -PackagesRoot $packagesRoot -Limit 0

# Assert package created
$pkg = Get-ChildItem $packagesRoot | Select-Object -First 1
if (-not $pkg) { Write-Error 'No package created'; exit 1 }
$pkgDir = $pkg.FullName
$manifest = Join-Path $pkgDir 'manifest.csv'
if (-not (Test-Path $manifest)) { Write-Error 'manifest missing'; exit 1 }

# Assert that doc1.pdf.navi.json exists in package and contains packaged=true
$pn1 = Join-Path $pkgDir 'doc1.pdf.navi.json'
$j1 = Get-Content $pn1 -Raw | ConvertFrom-Json
if ($j1.packaged -ne $true) { Write-Error 'doc1 not packaged correctly'; exit 1 }

# Assert that doc2.pdf.navi.json wrapper exists and note present
$pn2 = Join-Path $pkgDir 'doc2.pdf.navi.json'
$j2 = Get-Content $pn2 -Raw | ConvertFrom-Json
if ($j2.packaged -ne $true) { Write-Error 'doc2 wrapper missing packaged=true'; exit 1 }

# Assert that doc3.pdf.navi.json wrapper exists
$pn3 = Join-Path $pkgDir 'doc3.pdf.navi.json'
$j3 = Get-Content $pn3 -Raw | ConvertFrom-Json
if ($j3.packaged -ne $true) { Write-Error 'doc3 wrapper missing packaged=true'; exit 1 }

Write-Output 'Packager test passed'
Exit 0