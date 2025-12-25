$script:naviRoot = $env:NAVI_ROOT
if (-not $script:naviRoot) {
  # try resolving relative to the repo (tests/unit -> ../../NAVI)
  $candidate = Join-Path $PSScriptRoot '..\..' 'NAVI'
  if (Test-Path $candidate) { $script:naviRoot = (Get-Item $candidate).FullName }
}

function Map-Route-To-Office($route, $cfg) {
  # try exact match on function keys
  foreach ($k in $cfg.function_to_office.PSObject.Properties) {
    if ($k.Name.ToLower() -eq $route.ToLower()) { return $k.Value }
  }
  # check segments
  $parts = $route -split '\.'
  foreach ($seg in $parts) {
    foreach ($k in $cfg.function_to_office.PSObject.Properties) {
      if ($k.Name.ToLower() -eq $seg.ToLower()) { return $k.Value }
    }
  }
  return $null
}

Describe 'Route to Office resolution' {

  It 'loads routing_config and has function_to_office mappings' {
    if (-not $script:naviRoot) {
      $candidate = Join-Path $PSScriptRoot '..\..' 'NAVI'
      if (Test-Path $candidate) { $script:naviRoot = (Get-Item $candidate).FullName }
    }
    $configPath = Join-Path $script:naviRoot 'config\routing_config.json'
    if (-not $script:naviRoot -or -not (Test-Path $configPath)) { Skip -Reason "routing_config.json not found at $configPath" }
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    $cfg.function_to_office | Should -Not -BeNullOrEmpty
    $cfg.function_to_office.Finance | Should -Be 'CFO'
    $cfg.function_to_office.DevOps | Should -Be 'DREW'
  }

  It 'maps Finance and Finance.* to CFO' {
    if (-not $script:naviRoot) {
      $candidate = Join-Path $PSScriptRoot '..\..' 'NAVI'
      if (Test-Path $candidate) { $script:naviRoot = (Get-Item $candidate).FullName }
    }
    $configPath = Join-Path $script:naviRoot 'config\routing_config.json'
    if (-not $script:naviRoot -or -not (Test-Path $configPath)) { Skip -Reason "routing_config.json not found at $configPath" }
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
$mapper = { param($route,$cfg) foreach ($k in $cfg.function_to_office.PSObject.Properties) { if ($k.Name.ToLower() -eq $route.ToLower()) { return $k.Value } } $parts = $route -split '\.'; for ($i = $parts.Length - 1; $i -ge 0; $i--) { $seg = $parts[$i]; foreach ($k in $cfg.function_to_office.PSObject.Properties) { if ($k.Name.ToLower() -eq $seg.ToLower()) { return $k.Value } } } return $null }
    (& $mapper 'Finance' $cfg) | Should -Be 'CFO'
    (& $mapper 'Desk.Finance' $cfg) | Should -Be 'CFO'
  }

  It 'maps DevOps keywords to DREW' {
    if (-not $script:naviRoot) {
      $candidate = Join-Path $PSScriptRoot '..\..' 'NAVI'
      if (Test-Path $candidate) { $script:naviRoot = (Get-Item $candidate).FullName }
    }
    $configPath = Join-Path $script:naviRoot 'config\routing_config.json'
    if (-not $script:naviRoot -or -not (Test-Path $configPath)) { Skip -Reason "routing_config.json not found at $configPath" }
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    $mapper = { param($route,$cfg) foreach ($k in $cfg.function_to_office.PSObject.Properties) { if ($k.Name.ToLower() -eq $route.ToLower()) { return $k.Value } } $parts = $route -split '\.'; for ($i = $parts.Length - 1; $i -ge 0; $i--) { $seg = $parts[$i]; foreach ($k in $cfg.function_to_office.PSObject.Properties) { if ($k.Name.ToLower() -eq $seg.ToLower()) { return $k.Value } } } return $null }
    (& $mapper 'DevOps' $cfg) | Should -Be 'DREW'
    $actual = (& $mapper 'Infra.DevOps' $cfg)
    Write-Host "DEBUG: mapping 'Infra.DevOps' -> [$actual]"
    $actual | Should -Be 'DREW'
  }

  It 'verifies target inbox folders exist for mapped offices' {
    if (-not $script:naviRoot) {
      $candidate = Join-Path $PSScriptRoot '..\..' 'NAVI'
      if (Test-Path $candidate) { $script:naviRoot = (Get-Item $candidate).FullName }
    }
    $configPath = Join-Path $script:naviRoot 'config\routing_config.json'
    if (-not $script:naviRoot -or -not (Test-Path $configPath)) { Skip -Reason "routing_config.json not found at $configPath" }
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    foreach ($p in $cfg.function_to_office.PSObject.Properties) {
      $office = $p.Value
      $inbox = Join-Path $script:naviRoot (Join-Path 'offices' (Join-Path $office 'inbox'))
      Test-Path $inbox | Should -BeTrue
    }
  }
}
