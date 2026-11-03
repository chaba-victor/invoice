# Generates the app icons from the logo symbol in resources/scripts/components/icons/MainLogo.vue:
# a rounded square with a primary-500 -> primary-400 gradient and four white document lines.
# Writes public/favicons/* (web app, PWA manifest) and build/icon.ico (Windows installer and exe).
# Usage (Windows PowerShell): powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$favicons = Join-Path $root 'public\favicons'

# --color-primary-500 / --color-primary-400 in resources/sass/themes.scss
$dark = [System.Drawing.Color]::FromArgb(255, 88, 81, 216)
$light = [System.Drawing.Color]::FromArgb(255, 138, 133, 228)

# Draws the symbol at $size px, as vectors so every size is sharp. Units are the logo's 32-unit box.
# $rounded = $false fills the whole square (iOS rounds the corners itself).
function New-IconBitmap([int]$size, [bool]$rounded = $true) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $k = $size / 32.0

  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($rounded) {
    $d = 16 * $k
    $shape.AddArc(0, 0, $d, $d, 180, 90)
    $shape.AddArc($size - $d, 0, $d, $d, 270, 90)
    $shape.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $shape.AddArc(0, $size - $d, $d, $d, 90, 90)
    $shape.CloseFigure()
  } else {
    $shape.AddRectangle((New-Object System.Drawing.RectangleF 0, 0, $size, $size))
  }

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $size, $size), $dark, $light
  $g.FillPath($brush, $shape)

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(1.0, 2.5 * $k))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  # Same lines as MainLogo.vue, shifted into the square: (y, end x), all starting at x = 10.
  foreach ($line in @(@(9, 22), @(14, 22), @(19, 16), @(24, 19))) {
    $g.DrawLine($pen, 10 * $k, $line[0] * $k, $line[1] * $k, $line[0] * $k)
  }

  $pen.Dispose(); $brush.Dispose(); $shape.Dispose(); $g.Dispose()
  return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return ,$ms.ToArray()
}

function Save-Png([int]$size, [string]$path, [bool]$rounded = $true) {
  $bmp = New-IconBitmap $size $rounded
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# .ico with PNG-compressed entries (supported since Windows Vista).
function Save-Ico([int[]]$sizes, [string]$path) {
  $images = foreach ($s in $sizes) { $bmp = New-IconBitmap $s; ,@($s, (Get-PngBytes $bmp)); $bmp.Dispose() }
  $w = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($path))
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$images.Count)
  $offset = 6 + 16 * $images.Count
  foreach ($img in $images) {
    $dim = if ($img[0] -ge 256) { 0 } else { $img[0] }
    $w.Write([Byte]$dim); $w.Write([Byte]$dim); $w.Write([Byte]0); $w.Write([Byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$img[1].Length); $w.Write([UInt32]$offset)
    $offset += $img[1].Length
  }
  foreach ($img in $images) { $w.Write($img[1]) }
  $w.Close()
}

Save-Png 16 (Join-Path $favicons 'favicon-16x16.png')
Save-Png 32 (Join-Path $favicons 'favicon-32x32.png')
Save-Png 150 (Join-Path $favicons 'mstile-150x150.png')
Save-Png 192 (Join-Path $favicons 'android-chrome-192x192.png')
Save-Png 256 (Join-Path $favicons 'android-chrome-256x256.png')
Save-Png 512 (Join-Path $favicons 'android-chrome-512x512.png')
Save-Png 180 (Join-Path $favicons 'apple-touch-icon.png') $false
Save-Ico @(48, 32, 16) (Join-Path $favicons 'favicon.ico')
Save-Ico @(256, 128, 64, 48, 32, 24, 16) (Join-Path $root 'build\icon.ico')

# Safari pinned tab: a single-colour silhouette (Safari applies the mask-icon colour).
@'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <mask id="lines">
    <rect width="32" height="32" rx="8" fill="#fff"/>
    <path d="M10 9H22M10 14H22M10 19H16M10 24H19" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>
  </mask>
  <rect width="32" height="32" rx="8" fill="#000" mask="url(#lines)"/>
</svg>
'@ | Set-Content -Encoding utf8 (Join-Path $favicons 'safari-pinned-tab.svg')

'Icons written to public/favicons and build/icon.ico'
