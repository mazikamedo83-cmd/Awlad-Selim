$folder = "C:\Users\ALATTAL\Desktop\farouk-tools\قسم شيبسي وسناكس"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

# كل الـ Product IDs
$ids = @(
    1251
    1271
    1274
    1276
    1281
    1282
    1283
    1284
    1285
    1295
    1296
    1297
    1330
    1331
    1332
    1333
    1334
    1336
    1338
    1344
    1345
    1346
    1347
    1403
    1453
    1459
    1460
    1461
    1505
    1510
    1517
    1518
    1528
    1529
    1530
    1531
    1532
    1533
    1534
    1561
    1562
    1563
    1564
    1574
    1599
    1600
    1617
    1655
    1668
    1681
    1690
    1726
    1737
    1738
    1740
    1781
    1782
    2826
    2842
    2843
    2845
    2853
    2863
    2864
    2882
    2893
    2907
    2915
    2933
    2947
    2949
    2958
    2987
    3001
    3002
    646
    647
    649
    652
    654
    656
    657
    660
    661
    662
    667
    668
)

$failed = @()

foreach ($id in $ids) {

    $url = "http://78.89.159.126:9393/TheOneAboLasheenAPI/ItemsPhoto/$id.jpg"
    $output = Join-Path $folder "$id.jpg"

    Write-Host "Downloading $id ..." -ForegroundColor Cyan

    $success = $false

    # نحاول مرتين
    for ($attempt = 1; $attempt -le 2; $attempt++) {

        try {
            $response = Invoke-WebRequest `
                -Uri $url `
                -TimeoutSec 20 `
                -UseBasicParsing

            $contentType = $response.Headers["Content-Type"]

            if ($response.StatusCode -eq 200 -and
                $contentType -like "image/*" -and
                $response.Content.Length -gt 100) {

                [System.IO.File]::WriteAllBytes(
                    $output,
                    $response.Content
                )

                # التحقق من أن الملف ليس فارغًا
                if ((Get-Item $output).Length -gt 100) {
                    Write-Host "OK -> $id.jpg" -ForegroundColor Green
                    $success = $true
                    break
                }
            }

            Write-Host "Retry $id ..." -ForegroundColor Yellow
        }
        catch {
            Write-Host "Retry $id ..." -ForegroundColor Yellow
        }

        Start-Sleep -Milliseconds 500
    }

    if (-not $success) {
        Write-Host "FAILED -> $id" -ForegroundColor Red
        $failed += $id
    }
}

# حفظ الـ IDs التي فشلت
$failedFile = Join-Path $folder "Failed.txt"
$failed | Out-File -FilePath $failedFile -Encoding UTF8

Write-Host ""
Write-Host "============================"
Write-Host "انتهى التحميل"
Write-Host "إجمالي الـ IDs: $($ids.Count)"
Write-Host "تم التحميل: $($ids.Count - $failed.Count)"
Write-Host "فشل: $($failed.Count)"
Write-Host "============================"
Write-Host "المجلد:"
Write-Host $folder
Write-Host ""
Write-Host "الـ IDs الفاشلة موجودة في:"
Write-Host $failedFile