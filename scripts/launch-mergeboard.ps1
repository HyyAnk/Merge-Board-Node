$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$AppUrl = "http://127.0.0.1:4173"
$ServerLog = Join-Path $ProjectDir ".mergeboard-server.log"
$ErrorLog = Join-Path $ProjectDir ".mergeboard-server-error.log"
$InstallLog = Join-Path $ProjectDir ".mergeboard-install.log"
$PidFile = Join-Path $ProjectDir ".mergeboard-server.pid"
$StartedAt = Get-Date

function Write-Log {
    param(
        [ValidateSet("INFO", "STEP", "OK", "WARN", "ERROR", "DEBUG")]
        [string]$Level,
        [string]$Message,
        [string]$Step
    )

    $levelColor = switch ($Level) {
        "INFO" { "Cyan" }
        "STEP" { "Blue" }
        "OK" { "Green" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
        "DEBUG" { "DarkGray" }
    }

    Write-Host "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] " -ForegroundColor DarkGray -NoNewline
    Write-Host "[$Level] " -ForegroundColor $levelColor -NoNewline
    Write-Host "[STEP:$Step] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Test-Mergeboard {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $AppUrl -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match "Mergeboard"
    }
    catch {
        return $false
    }
}

function Stop-WithError {
    param([string]$Message, [string]$Step, [string]$Suggestion)

    Write-Log -Level ERROR -Message "$Message Goi y: $Suggestion" -Step $Step
    $elapsed = [math]::Round(((Get-Date) - $StartedAt).TotalSeconds, 1)
    Write-Log -Level ERROR -Message "Tong ket: total=1 success=0 failed=1 skipped=0 retries=0 elapsed=${elapsed}s" -Step "summary"
    exit 1
}

Write-Log -Level INFO -Message "Config: Mergeboard local web app; profiles=1; mode=local; concurrency=1" -Step "startup"
Write-Log -Level INFO -Message "Project: $ProjectDir" -Step "startup"
Write-Log -Level INFO -Message "Automation: Vite HTTP server; khong dung chuot, ban phim, clipboard hay OS input focus" -Step "startup"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithError -Message "Khong tim thay Node.js." -Step "check_node" -Suggestion "Cai Node.js LTS tu nodejs.org roi chay lai."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Stop-WithError -Message "Khong tim thay npm." -Step "check_npm" -Suggestion "Cai lai Node.js LTS kem npm."
}
Write-Log -Level OK -Message "Node.js va npm da san sang." -Step "check_runtime"

Set-Location -LiteralPath $ProjectDir

if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "node_modules"))) {
    Write-Log -Level STEP -Message "Dang cai dat thu vien lan dau..." -Step "install_dependencies"
    & npm.cmd install *> $InstallLog
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError -Message "Cai thu vien that bai." -Step "install_dependencies" -Suggestion "Kiem tra ket noi mang va file $InstallLog."
    }
    Write-Log -Level OK -Message "Da cai dat thu vien." -Step "install_dependencies"
}
else {
    Write-Log -Level INFO -Message "Thu vien da san sang; bo qua cai dat." -Step "install_dependencies"
}

if (Test-Mergeboard) {
    Write-Log -Level INFO -Message "Server dang chay san tai cong 4173." -Step "start_server"
}
else {
    Write-Log -Level STEP -Message "Dang khoi dong server nen tai cong 4173..." -Step "start_server"
    Remove-Item -LiteralPath $ServerLog, $ErrorLog -Force -ErrorAction SilentlyContinue

    try {
        $server = Start-Process `
            -FilePath "npm.cmd" `
            -ArgumentList @("run", "dev", "--", "--port", "4173") `
            -WorkingDirectory $ProjectDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $ServerLog `
            -RedirectStandardError $ErrorLog `
            -PassThru
        Set-Content -LiteralPath $PidFile -Value $server.Id
    }
    catch {
        Stop-WithError -Message "Khong tao duoc tien trinh server: $($_.Exception.Message)" -Step "start_server" -Suggestion "Thu chay npm run dev -- --port 4173 trong PowerShell."
    }

    $ready = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        if (Test-Mergeboard) {
            $ready = $true
            break
        }

        if ($attempt -in @(10, 20)) {
            Write-Log -Level INFO -Message "Dang doi server; progress=$attempt/30" -Step "wait_server"
        }
        Start-Sleep -Seconds 1
    }

    if (-not $ready) {
        Stop-WithError -Message "Server khong phan hoi sau 30 giay." -Step "wait_server" -Suggestion "Xem $ErrorLog."
    }
    Write-Log -Level OK -Message "Server da san sang tai $AppUrl." -Step "wait_server"
}

if ($env:MERGEBOARD_NO_BROWSER -eq "1") {
    Write-Log -Level INFO -Message "Che do kiem thu; bo qua mo trinh duyet." -Step "open_browser"
}
else {
    Write-Log -Level STEP -Message "Dang mo Mergeboard bang trinh duyet mac dinh..." -Step "open_browser"
    try {
        Start-Process $AppUrl
        Write-Log -Level OK -Message "Da mo Mergeboard." -Step "open_browser"
    }
    catch {
        Write-Log -Level WARN -Message "Khong mo duoc trinh duyet tu dong. Mo thu cong: $AppUrl" -Step "open_browser"
    }
}

$elapsed = [math]::Round(((Get-Date) - $StartedAt).TotalSeconds, 1)
Write-Log -Level OK -Message "Tong ket: total=1 success=1 failed=0 skipped=0 retries=0 elapsed=${elapsed}s" -Step "summary"
Write-Log -Level INFO -Message "Server tiep tuc chay nen; co the dong cua so launcher." -Step "summary"
Start-Sleep -Seconds 2
exit 0
