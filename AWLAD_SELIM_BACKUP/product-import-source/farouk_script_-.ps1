$folder = "$env:USERPROFILE\Desktop\اسكريبت_محمود_فاروق"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

for ($i = 1; $i -le 4011; $i++) {
    $url = "http://78.89.159.126:9393/TheOneAboLasheenAPI/ItemsPhoto/$i.jpg"

    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing

        if ($response.StatusCode -eq 200 -and
            $response.Headers["Content-Type"] -like "image/*" -and
            $response.Content.Length -gt 0) {

            [System.IO.File]::WriteAllBytes("$folder\$i.jpg", $response.Content)
            Write-Host "Downloaded $i.jpg"
        }
        else {
            Write-Host "Skipped $i"
        }
    }
    catch {
        Write-Host "Skipped $i"
    }
}