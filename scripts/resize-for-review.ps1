# One-off helper for Claude sessions captioning a new photo batch.
# Downscales copies of source photos to a scratch folder so the model reads
# ~1800px working copies instead of Marc's full-resolution originals
# (often 4000-6000px) -- the site never serves anything above 1920px anyway,
# so reading full-res just to identify a sponsor sticker or plate wastes
# vision tokens for no quality benefit. Originals are never modified.
# Uses .NET System.Drawing directly -- no npm install required.
#
# Usage: powershell -File scripts/resize-for-review.ps1 <source-dir> <output-dir>

param(
  [Parameter(Mandatory=$true)][string]$SrcDir,
  [Parameter(Mandatory=$true)][string]$OutDir
)

Add-Type -AssemblyName System.Drawing

$MaxDim = 1800

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$files = Get-ChildItem $SrcDir -File | Where-Object { $_.Extension -match '\.(jpe?g|png|webp)$' }
if ($files.Count -eq 0) {
  Write-Output "No images found in $SrcDir"
  exit 0
}

foreach ($file in $files) {
  $img = [System.Drawing.Image]::FromFile($file.FullName)
  $ratio = [Math]::Min($MaxDim / $img.Width, $MaxDim / $img.Height)
  if ($ratio -gt 1) { $ratio = 1 }  # never upscale
  $newW = [int]($img.Width * $ratio)
  $newH = [int]($img.Height * $ratio)

  $resized = New-Object System.Drawing.Bitmap $newW, $newH
  $graphics = [System.Drawing.Graphics]::FromImage($resized)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($img, 0, 0, $newW, $newH)

  $destName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) + ".jpg"
  $destPath = Join-Path $OutDir $destName

  $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
  $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, 85L)
  $resized.Save($destPath, $jpegCodec, $encParams)

  $graphics.Dispose()
  $resized.Dispose()
  $img.Dispose()

  Write-Output "OK $($file.Name) -> ${newW}x${newH}"
}

Write-Output ""
Write-Output "Done -- $($files.Count) downscaled copies in $OutDir"
