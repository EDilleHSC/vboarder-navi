Describe 'deliver-package post-delivery verification' {
  It 'writes a post-delivery report and delivered sidecars are present' {
    $tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "test_deliver_$([guid]::NewGuid().ToString())")
    $navi = Join-Path $tmp 'NAVI'
    $pkg = Join-Path $navi 'packages\testpkg'
    New-Item -ItemType Directory -Path $pkg -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $navi 'offices\finance\inbox') -Force | Out-Null
    $file = New-Item -ItemType File -Path (Join-Path $pkg 'bill.pdf') -Force
    $naviFile = @{ note='orig' } | ConvertTo-Json | Out-File -FilePath (Join-Path $pkg 'bill.pdf.navi.json') -Encoding utf8

    pwsh -NoProfile -ExecutionPolicy Bypass -File "$(Resolve-Path ..\..\scripts\deliver-package.ps1)" -PackageName 'testpkg' -NaviRoot $navi -Apply -Force | Out-Null

    $reports = Get-ChildItem -Path (Join-Path $navi 'approvals\delivery_reports') -File -ErrorAction SilentlyContinue
    $reports.Count | Should -BeGreaterThan 0

    # verify delivered file in inbox
    $delivered = Get-ChildItem -Path (Join-Path $navi 'offices\finance\inbox') -File | Where-Object { $_.Name -eq 'bill.pdf' }
    $delivered.Count | Should -Be 1

    # verify sidecar has delivered
    $sidecar = (Get-Content (Join-Path $navi 'offices\finance\inbox\bill.pdf.navi.json') -Raw) | ConvertFrom-Json
    $sidecar.delivered | Should -Not -BeNullOrEmpty

    Remove-Item -LiteralPath $tmp -Recurse -Force
  }
}
