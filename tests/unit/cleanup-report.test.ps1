Describe 'cleanup-reset-runlog run report' {
  BeforeAll {
    $script:temp = Join-Path $env:TEMP ("navi_report_test_" + (Get-Random))
    New-Item -ItemType Directory -Path $script:temp -Force | Out-Null
    # create minimal NAVI structure
    New-Item -ItemType Directory -Path (Join-Path $script:temp 'NAVI\packages') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $script:temp 'NAVI\packages\dummy.txt') -Force | Out-Null
  }
  AfterAll {
    Remove-Item -LiteralPath $script:temp -Recurse -Force -ErrorAction SilentlyContinue
  }

  It 'creates a run report on non-dry run' {
    $testDir = if ($MyInvocation -and $MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { (Get-Location).Path }
    $scriptPath = Join-Path $testDir '..\..\scripts\cleanup-reset-runlog.ps1'
    $script = Resolve-Path $scriptPath -ErrorAction SilentlyContinue
    if (-not $script) { $script = Resolve-Path (Join-Path (Get-Location) '..\scripts\cleanup-reset-runlog.ps1') }
    if (-not $script) { throw "Could not locate cleanup script at $scriptPath" }

    $reportDir = Join-Path $script:temp 'NAVI\approvals\cleanup_reports'
    # Ensure doesn't exist before
    (Test-Path $reportDir) | Should -BeFalse

    # Run the script: pass -Confirm:$false to satisfy presence without prompting
    $cmd = "& { . '$($script)' -NaviRoot '$($script:temp)\NAVI' -Scope tests -Confirm:`$false }"
    $output = pwsh -NoProfile -Command $cmd 2>&1

    # After running, check report dir exists and contains a file cleanup_*.json
    (Test-Path $reportDir) | Should -BeTrue
    $files = Get-ChildItem -Path $reportDir -Filter 'cleanup_*.json' -File -ErrorAction SilentlyContinue
    ($files.Count) | Should -BeGreaterThan 0

    # Verify archive folder exists and at least one cleanup-backup_* directory or zip was produced
    $archiveDir = Join-Path $script:temp 'NAVI\archive'
    (Test-Path $archiveDir) | Should -BeTrue
    $backupDirs = Get-ChildItem -Path $archiveDir -Filter 'cleanup-backup_*' -Directory -ErrorAction SilentlyContinue
    $zipFiles = Get-ChildItem -Path $archiveDir -Filter 'cleanup-backup_*.zip' -File -ErrorAction SilentlyContinue
    ($backupDirs.Count + $zipFiles.Count) | Should -BeGreaterThan 0
  }
}