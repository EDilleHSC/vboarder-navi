Describe 'clean-office-inbox' {
  It 'archives files when Archive and DryRun are set (dry-run shows actions)' {
    $tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "test_inbox_$([guid]::NewGuid().ToString())")
    $navi = Join-Path $tmp 'NAVI'
    New-Item -ItemType Directory -Path (Join-Path $navi 'offices\finance\inbox') -Force | Out-Null
    $f = New-Item -ItemType File -Path (Join-Path $navi 'offices\finance\inbox\bill.pdf') -Force
    & pwsh -NoProfile -ExecutionPolicy Bypass -File "$(Resolve-Path ..\..\scripts\clean-office-inbox.ps1)" -Office 'finance' -NaviRoot $navi -DryRun -Archive | Out-Null
    # cleanup
    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
