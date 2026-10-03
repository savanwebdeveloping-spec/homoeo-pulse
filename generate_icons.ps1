Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "logo.jpeg"
if (-not (Test-Path $srcPath)) {
    Write-Host "Error: logo.jpeg not found"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

function Resize-Image($source, $targetPath, $width, $height) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($source, 0, 0, $width, $height)
    $bmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated: $targetPath ($width x $height)"
}

# 1. Generate Play Store Assets
Resize-Image $srcImg (Join-Path $PSScriptRoot "playstore_icon_512.png") 512 512

# Feature Graphic (1024x500) with medical gradient background and centered logo
$featBmp = New-Object System.Drawing.Bitmap(1024, 500)
$featG = [System.Drawing.Graphics]::FromImage($featBmp)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(1024, 500)),
    [System.Drawing.ColorTranslator]::FromHtml("#008744"),
    [System.Drawing.ColorTranslator]::FromHtml("#0F172A")
)
$featG.FillRectangle($brush, 0, 0, 1024, 500)
# Draw centered logo scaled to 360x360
$logoX = (1024 - 360) / 2
$logoY = (500 - 360) / 2
$featG.DrawImage($srcImg, $logoX, $logoY, 360, 360)
$featBmp.Save((Join-Path $PSScriptRoot "playstore_feature_graphic_1024x500.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$featG.Dispose()
$brush.Dispose()
$featBmp.Dispose()
Write-Host "Generated: playstore_feature_graphic_1024x500.png (1024 x 500)"

# 2. Generate Mipmap Icons for Android
$resPath = Join-Path $PSScriptRoot "android\app\src\main\res"

$sizes = @{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}

foreach ($folder in $sizes.Keys) {
    $dim = $sizes[$folder]
    $dir = Join-Path $resPath $folder
    if (Test-Path $dir) {
        Resize-Image $srcImg (Join-Path $dir "ic_launcher.png") $dim $dim
        Resize-Image $srcImg (Join-Path $dir "ic_launcher_round.png") $dim $dim
        Resize-Image $srcImg (Join-Path $dir "ic_launcher_foreground.png") $dim $dim
    }
}

$srcImg.Dispose()
Write-Host "All icons generated successfully!"
