Describe 'deliver-package dry-run flag compatibility' {
  It 'accepts -DryRun without error and does not deliver files' {
    $tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "test_deliver_dryrun_$([guid]::NewGuid().ToString())")
    $navi = Join-Path $tmp 'NAVI'
    $pkg = Join-Path $navi 'packages\testpkg'
    New-Item -ItemType Directory -Path $pkg -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $navi 'offices\finance\inbox') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $pkg 'bill.pdf') -Force | Out-Null
    "filename,route,applied_at" | Out-File -FilePath (Join-Path $pkg 'manifest.csv') -Encoding utf8
    "bill.pdf,finance,$((Get-Date).ToString('o'))" | Out-File -FilePath (Join-Path $pkg 'manifest.csv') -Encoding utf8 -Append

    # Run with -DryRun explicitly
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$(Resolve-Path ..\..\scripts\deliver-package.ps1)" -PackageName 'testpkg' -NaviRoot $navi -DryRun | Out-Null

    # Ensure nothing delivered
    (Get-ChildItem -Path (Join-Path $navi 'offices\finance\inbox') -File -ErrorAction SilentlyContinue).Count | Should -Be 0

    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}