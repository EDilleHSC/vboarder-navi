Describe 'cleanup-reset-runlog idempotency' {
  BeforeAll {
    $script:temp = Join-Path $env:TEMP ("navi_idempotency_" + (Get-Random))
    New-Item -ItemType Directory -Path (Join-Path $script:temp 'NAVI\packages') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $script:temp 'NAVI\packages\x.txt') -Force | Out-Null
  }
  AfterAll {
    Remove-Item -LiteralPath $script:temp -Recurse -Force -ErrorAction SilentlyContinue
  }

  It 'creates multiple backups when run twice and does not lose reports' {
    $testDir = if ($MyInvocation -and $MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { (Get-Location).Path }
    $scriptCandidate = Join-Path $testDir '..\..\scripts\cleanup-reset-runlog.ps1'
    $resolved = Resolve-Path $scriptCandidate -ErrorAction SilentlyContinue
    if ($resolved) { $scriptPath = $resolved.ProviderPath } else { $scriptPath = (Join-Path (Get-Location) '..\scripts\cleanup-reset-runlog.ps1') }
    if (-not (Test-Path $scriptPath)) { throw "Could not locate cleanup script at $scriptPath" }
    $cmd = "& { . '$($scriptPath)' -NaviRoot '$($script:temp)\NAVI' -Scope all -Confirm:`$false }"

    # First run
    $out1 = pwsh -NoProfile -Command $cmd 2>&1
    # Second run
    Start-Sleep -Milliseconds 500
    $out2 = pwsh -NoProfile -Command $cmd 2>&1

    # verify archive produces at least two backups (dirs or zips)
    $archive = Join-Path $script:temp 'NAVI\archive'
    (Test-Path $archive) | Should -BeTrue
    $backupDirs = Get-ChildItem -Path $archive -Filter 'cleanup-backup_*' -Directory -ErrorAction SilentlyContinue
    $zipFiles = Get-ChildItem -Path $archive -Filter 'cleanup-backup_*.zip' -File -ErrorAction SilentlyContinue
    ($backupDirs.Count + $zipFiles.Count) | Should -BeGreaterThan 1

    # verify run reports exist and there are at least two
    $reportDir = Join-Path $script:temp 'NAVI\approvals\cleanup_reports'
    (Test-Path $reportDir) | Should -BeTrue
    $reports = Get-ChildItem -Path $reportDir -Filter 'cleanup_*.json' -File -ErrorAction SilentlyContinue
    ($reports.Count) | Should -BeGreaterThan 1

    # verify backup names are unique (no accidental overwrite)
    $names = ($backupDirs | ForEach-Object { $_.Name }) + ($zipFiles | ForEach-Object { $_.Name })
    ($names | Select-Object -Unique).Count | Should -Be ($names.Count)
  }
}