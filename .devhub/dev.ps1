param([string]$Script = "dev")
& node (Join-Path $PSScriptRoot "launch.cjs") $Script
exit $LASTEXITCODE
