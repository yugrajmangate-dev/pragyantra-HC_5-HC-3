<#
run_local.ps1
Usage:
  .\run_local.ps1 [-Provider openai|groq|anthropic] [-ApiKey '<your_key>']

This script will create a venv if missing, install requirements, prompt for an API key if not provided,
set environment variables for the session and start uvicorn. The key is not written to disk.
#>

param(
    [string]$Provider = "openai",
    [string]$ApiKey = ""
)

Set-StrictMode -Version Latest

Push-Location $PSScriptRoot

if (-not (Test-Path .\venv)) {
    Write-Host "Creating virtual environment (venv)..."
    python -m venv venv
}

Write-Host "Activating virtual environment..."
& .\venv\Scripts\Activate.ps1

Write-Host "Installing requirements (if needed)..."
python -m pip install --upgrade pip
pip install -r requirements.txt

if (-not $ApiKey) {
    $secure = Read-Host -Prompt "Paste your ASSISTANT_API_KEY (input hidden)" -AsSecureString
    $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

$env:ASSISTANT_PROVIDER = $Provider
$env:ASSISTANT_API_KEY = $ApiKey

Write-Host "Starting backend on http://127.0.0.1:8001 (CTRL+C to stop)..."
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001

Pop-Location
