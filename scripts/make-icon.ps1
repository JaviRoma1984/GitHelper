# Genera build\icon.png y build\icon.ico dibujando el símbolo de GitHelper (ramas que se separan y se funden).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)
    $k = $size / 256.0

    function P([double]$x, [double]$y) { [System.Drawing.PointF]::new([single]($x * $k), [single]($y * $k)) }
    function Rounded($x, $y, $w, $h, $r) {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $r * 2 * $k
        $path.AddArc($x * $k, $y * $k, $d, $d, 180, 90)
        $path.AddArc(($x + $w) * $k - $d, $y * $k, $d, $d, 270, 90)
        $path.AddArc(($x + $w) * $k - $d, ($y + $h) * $k - $d, $d, $d, 0, 90)
        $path.AddArc($x * $k, ($y + $h) * $k - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        return $path
    }

    # fondo
    $bg = Rounded 6 6 244 244 52
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#0d1117'))), $bg)
    $g.DrawPath([System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#30363d'), [single](5 * $k)), $bg)

    $blue = [System.Drawing.ColorTranslator]::FromHtml('#58a6ff')
    $orange = [System.Drawing.ColorTranslator]::FromHtml('#f0883e')
    $green = [System.Drawing.ColorTranslator]::FromHtml('#3fb950')
    $dark = [System.Drawing.ColorTranslator]::FromHtml('#0d1117')

    $w = [single]([Math]::Max(2.0, 11 * $k))
    $penBlue = [System.Drawing.Pen]::new($blue, $w)
    $penBlue.StartCap = 'Round'; $penBlue.EndCap = 'Round'
    $penOr = [System.Drawing.Pen]::new($orange, $w)
    $penOr.StartCap = 'Round'; $penOr.EndCap = 'Round'

    # separador entre los dos dibujos (GitHub a la izquierda, tu carpeta a la derecha)
    $penDiv = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#30363d'), [single]([Math]::Max(1.0, 4 * $k)))
    $g.DrawLine($penDiv, (P 128 52), (P 128 204))

    function Dot($cx, $cy, $r, $color) {
        $rr = $r * $k
        $g.FillEllipse((New-Object System.Drawing.SolidBrush $dark), [single]($cx * $k - $rr - 4 * $k), [single]($cy * $k - $rr - 4 * $k), [single](2 * $rr + 8 * $k), [single](2 * $rr + 8 * $k))
        $g.FillEllipse((New-Object System.Drawing.SolidBrush $color), [single]($cx * $k - $rr), [single]($cy * $k - $rr), [single](2 * $rr), [single](2 * $rr))
    }

    # un dibujo de ramas: rama principal con una rama que sale y vuelve a fundirse
    function Draw-Branches([double]$ox) {
        $g.DrawLine($penBlue, (P $ox 100), (P ($ox + 88) 100))
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddBezier((P ($ox + 34) 100), (P ($ox + 34) 150), (P ($ox + 40) 170), (P ($ox + 54) 170))
        $path.AddBezier((P ($ox + 54) 170), (P ($ox + 72) 170), (P ($ox + 88) 150), (P ($ox + 88) 100))
        $g.DrawPath($penOr, $path)
        Dot $ox 100 12 $blue
        Dot ($ox + 34) 100 12 $blue
        Dot ($ox + 54) 170 12 $orange
        Dot ($ox + 88) 100 12 $green
    }
    Draw-Branches 28
    Draw-Branches 140
    # anillo de HEAD en el último punto del dibujo de tu carpeta
    $ring = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#f0f6fc'), [single]([Math]::Max(1.5, 5 * $k)))
    $g.DrawEllipse($ring, [single]((228 - 22) * $k), [single]((100 - 22) * $k), [single](44 * $k), [single](44 * $k))

    $g.Dispose()
    return $bmp
}

function Get-PngBytes($bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = @{}
foreach ($s in $sizes) {
    $b = New-IconBitmap $s
    $images[$s] = Get-PngBytes $b
    if ($s -eq 256) { [System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.png'), $images[$s]) }
    $b.Dispose()
}

# .ico con imágenes PNG dentro
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($s in $sizes) {
    $bytes = $images[$s]
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$bytes.Length); $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
}
foreach ($s in $sizes) { $bw.Write($images[$s]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ms.ToArray())
Write-Output ("Icono creado en " + $outDir)
