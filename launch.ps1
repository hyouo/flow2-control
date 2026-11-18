$ErrorActionPreference = 'Stop'
try {
    $flowRoot = $PSScriptRoot
    $flowUrl = 'http://127.0.0.1:8842'
    $flowNode = (Get-Command node.exe -ErrorAction Stop).Source
    $flowBrowser = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $flowBrowser) { throw '请先安装 Chrome 或 Edge，再打开 FLOW2 Control。' }

    function Get-FlowHealth {
        try { Invoke-RestMethod -Uri "$flowUrl/api/health" -TimeoutSec 1 } catch { $null }
    }
    $flowHealth = Get-FlowHealth
    if ($flowHealth -and $flowHealth.app -ne 'flow2-control') { throw '端口 8842 正被其他应用使用。请关闭占用程序后重试。' }
    if (-not $flowHealth) {
        Start-Process -FilePath $flowNode -ArgumentList @('server.mjs') -WorkingDirectory $flowRoot -WindowStyle Hidden
        for ($flowAttempt = 0; $flowAttempt -lt 40; $flowAttempt++) {
            $flowHealth = Get-FlowHealth
            if ($flowHealth.app -eq 'flow2-control') { break }
            Start-Sleep -Milliseconds 150
        }
        if ($flowHealth.app -ne 'flow2-control') { throw 'FLOW2 Control 未能启动，请检查 Node.js 是否可用，以及端口 8842 是否被占用。' }
    }
    Start-Process -FilePath $flowBrowser -ArgumentList @("--app=$flowUrl", '--start-maximized')
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'FLOW2 Control') | Out-Null
    exit 1
}
