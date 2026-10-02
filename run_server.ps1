# Enable TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ports = @(8080, 8000, 8888, 3000, 5000, 8081, 8082, 8083)
$listener = $null
$selectedPort = $null

foreach ($p in $ports) {
    try {
        $testListener = New-Object System.Net.HttpListener
        $testListener.Prefixes.Add("http://localhost:$p/")
        $testListener.Start()
        $listener = $testListener
        $selectedPort = $p
        break
    } catch {
        if ($testListener) {
            try { $testListener.Close() } catch {}
        }
    }
}

if (-not $listener) {
    Write-Host "Loi: Khong the khoi tao may chu cuc bo tren cac cong 8080, 8000, 8888..." -ForegroundColor Red
    Write-Host "Dang mo truc tiep file index.html..." -ForegroundColor Yellow
    Start-Process "index.html"
    exit 1
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  TVTK 110kV NPSC - LOCAL WEB SERVER" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "May chu dang chay tai: http://localhost:$selectedPort/" -ForegroundColor Yellow
Write-Host "Tu dong mo trinh duyet..." -ForegroundColor White
Write-Host "De dung may chu, nhan Ctrl+C hoac dong cua so nay." -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

# Open default browser automatically
try {
    Start-Process "http://localhost:$selectedPort/"
} catch {
    Write-Host "Khong the tu dong mo trinh duyet. Vui long truy cap: http://localhost:$selectedPort/" -ForegroundColor Yellow
}

$currentDir = (Get-Item -Path ".").FullName
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath
        
        # CORS-free proxy endpoint for Google Sheets
        if ($urlPath -eq "/sync-sheet") {
            try {
                $sheetUrl = "https://docs.google.com/spreadsheets/d/1UMIJC0fAFuNfAARb6fyUETrD7nOV7whfHokbNa35Y2w/export?format=xlsx"
                $client = New-Object System.Net.WebClient
                $bytes = $client.DownloadData($sheetUrl)
                $response.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("Sync Failed: $_")
                $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            $response.Close()
            continue
        }

        if ($urlPath -eq "/") {
            $urlPath = "/index.html"
        }

        # Remove leading slash and resolve full file path safely
        $cleanPath = $urlPath.TrimStart('/')
        $filePath = Join-Path $currentDir $cleanPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            
            # Determine content type
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = "text/plain"
            if ($ext -eq ".html" -or $ext -eq ".htm") { $contentType = "text/html; charset=utf-8" }
            elseif ($ext -eq ".css") { $contentType = "text/css" }
            elseif ($ext -eq ".js") { $contentType = "application/javascript" }
            elseif ($ext -eq ".json") { $contentType = "application/json; charset=utf-8" }
            elseif ($ext -eq ".png") { $contentType = "image/png" }
            elseif ($ext -eq ".jpg" -or $ext -eq ".jpeg") { $contentType = "image/jpeg" }
            elseif ($ext -eq ".svg") { $contentType = "image/svg+xml" }
            
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("File Not Found: $cleanPath")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    }
} catch {
    # Clean exit on abort
} finally {
    if ($listener -and $listener.IsListening) {
        $listener.Stop()
    }
}
