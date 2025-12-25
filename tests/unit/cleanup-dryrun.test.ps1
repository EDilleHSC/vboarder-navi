Describe 'cleanup-reset-runlog dry-run behavior' {
  BeforeAll {
    $script:temp = Join-Path $env:TEMP ("navi_test_" + (Get-Random))
    New-Item -ItemType Directory -Path $script:temp -Force | Out-Null
    # create minimal NAVI structure
    New-Item -ItemType Directory -Path (Join-Path $script:temp 'NAVI\packages') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $script:temp 'NAVI\packages\dummy.txt') -Force | Out-Null
  }
  AfterAll {
    Remove-Item -LiteralPath $script:temp -Recurse -Force -ErrorAction SilentlyContinue
  }

  It 'does not remove files on DryRun and prints DRYRUN lines' {
    $testDir = if ($MyInvocation -and $MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { (Get-Location).Path }
    $scriptPath = Join-Path $testDir '..\..\scripts\cleanup-reset-runlog.ps1'
    $script = Resolve-Path $scriptPath -ErrorAction SilentlyContinue
    if (-not $script) { $script = Resolve-Path (Join-Path (Get-Location) '..\scripts\cleanup-reset-runlog.ps1') }
    if (-not $script) { throw "Could not locate cleanup script at $scriptPath" }
    $cmd = "& { . '$($script)' -NaviRoot '$($script:temp)\NAVI' -Scope tests -DryRun }"
    $output = pwsh -NoProfile -Command $cmd 2>&1
    ($output | Where-Object { $_ -match '\[DRYRUN\]' }) | Should -Not -BeNullOrEmpty
    (Test-Path (Join-Path $script:temp 'NAVI\packages\dummy.txt')) | Should -Be $true
  }
}