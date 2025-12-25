Describe 'PackageRoutedFiles PowerShell - Department naming' {
  It 'creates package with Department prefix when -Department provided' {
    $root = Join-Path $PSScriptRoot 'temp_ps_pkg_test'
    if (Test-Path $root) { Remove-Item -Path $root -Recurse -Force }
    New-Item -ItemType Directory -Path $root -Force | Out-Null

    $route = Join-Path $root 'route'
    New-Item -ItemType Directory -Path $route -Force | Out-Null
    Set-Content -Path (Join-Path $route 'sample1.txt') -Value 'one'
    '{"note":"sample"}' | Set-Content -Path (Join-Path $route 'sample1.txt.navi.json')
    Set-Content -Path (Join-Path $route 'sample2.txt') -Value 'two'

    $packagesRoot = Join-Path $root 'packages'

    # run script
    & (Join-Path $PSScriptRoot '..\..\scripts\package_routed_files.ps1') -RouteFolder $route -PackagesRoot $packagesRoot -Department 'Finance'

    # assertions
    $dirs = Get-ChildItem -Path $packagesRoot -Directory | Select-Object -ExpandProperty Name
    $dirs | Should -Not -BeNullOrEmpty
    ($dirs -join ',') | Should -Match '^FINANCE_'

    $pkg = Get-ChildItem -Path $packagesRoot -Directory | Select-Object -First 1
    $manifestPath = Join-Path $pkg.FullName 'manifest.csv'
    Test-Path $manifestPath | Should -BeTrue
    $manifest = Get-Content $manifestPath -Raw
    $manifest | Should -Match 'sample1.txt'

    # cleanup
    Remove-Item -Path $root -Recurse -Force
  }
}