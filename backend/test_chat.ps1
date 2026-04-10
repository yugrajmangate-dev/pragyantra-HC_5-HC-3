param([string]$Question = "Which region has the highest risk today?")

$body = @{ question = $Question } | ConvertTo-Json
try {
    $resp = Invoke-RestMethod -Uri http://127.0.0.1:8001/assistant/chat -Method Post -ContentType 'application/json' -Body $body -ErrorAction Stop
    $resp | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Request failed: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        try { Write-Host $_.Exception.Response.Content.ReadAsStringAsync().Result } catch { }
    }
}
