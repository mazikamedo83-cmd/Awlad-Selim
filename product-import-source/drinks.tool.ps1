$folder = "C:\Users\ALATTAL\Desktop\farouk-tools\مشروبات"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

$ids = @(
    1127
    1131
    1132
    1133
    1134
    1137
    1139
    1140
    1143
    1146
    1148
    1152
    1153
    1156
    1164
    1166
    1173
    1178
    1182
    1186
    1187
    1188
    1190
    1191
    1192
    1193
    1194
    1195
    1196
    1197
    1198
    1199
    1200
    1201
    1202
    1203
    1204
    1205
    1206
    1207
    1208
    1209
    1210
    1211
    1212
    1213
    1214
    1215
    1216
    1217
    1218
    1219
    1220
    1221
    1222
    1223
    1224
    1225
    1226
    1227
    1228
    1229
    1230
    1231
    1232
    1233
    1234
    1235
    1236
    1237
    1238
    1239
    1240
    1241
    1242
    1243
    1244
    1245
    1246
    1247
    1248
    1249
    1250
    1251
    1252
    1253
    1254
    1255
    1256
    1257
    1258
    1259
    1260
)

$failed = @()

foreach ($id in $ids) {

    $url = "http://78.89.159.126:9393/TheOneAboLasheenAPI/ItemsPhoto/$id.jpg"
    $output = Join-Path $folder "$id.jpg"

    Write-Host "Downloading $id ..." -ForegroundColor Cyan

    $success = $false

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
Write-Host "الـ IDs الفاشلة:"
Write-Host $failedFile