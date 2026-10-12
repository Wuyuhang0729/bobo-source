<#
.SYNOPSIS
    用 folia 自带的 ffmpeg 重新优化 GIF（两遍调色板法），把录好的演示图体积压下来。

.DESCRIPTION
    ScreenToGif 导出的 GIF 通常偏大。这里固定做三件事：
      - 限制帧率（默认 12 fps，界面演示足够）
      - 缩放到指定宽度（默认 900 px，README 里用 820 显示）
      - 两遍调色板：先 palettegen 生成调色板，再 paletteuse 套用（比单遍小 30–60%）
    原文件不会被覆盖，输出默认是 <原名>-opt.gif。

.EXAMPLE
    pwsh tools/optimize-gif.ps1 docs\images\search.gif
    pwsh tools/optimize-gif.ps1 docs\images\search.gif -Width 820 -Fps 10
    pwsh tools/optimize-gif.ps1 docs\images\*.gif            # 批量
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string[]]$Path,
    [int]$Width = 900,
    [int]$Fps = 12,
    [switch]$Overwrite,
    # 需要「完整版」ffmpeg（带 gif 编码器）。folia 自带的那份是精简构建，通常没有。
    [string]$FFmpegPath
)

$ErrorActionPreference = 'Stop'
$REPO = Split-Path -Parent $PSScriptRoot

# 选 ffmpeg：显式指定 > PATH > folia 自带
$candidates = @()
if ($FFmpegPath) { $candidates += $FFmpegPath }
$onPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($onPath) { $candidates += $onPath }
$candidates += (Join-Path $REPO 'folia\build\ffmpeg\win-x64\ffmpeg.exe')
$ffmpeg = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $ffmpeg) {
    Write-Host '✗ 找不到 ffmpeg' -ForegroundColor Red
    Write-Host '  装一个完整版：winget install Gyan.FFmpeg   或   传 -FFmpegPath <路径>'
    exit 1
}

# 这份 ffmpeg 能不能写 GIF？folia 自带的精简构建不能（只用来转码音频）
$encoders = (& $ffmpeg -hide_banner -encoders 2>&1 | Out-String)
if ($encoders -notmatch '(?m)^\s*[A-Z.]+\s+gif\s') {
    Write-Host "✗ 这份 ffmpeg 不含 GIF 编码器：$ffmpeg" -ForegroundColor Red
    Write-Host '  folia 自带的那份是精简构建（只做音频转码），请改用完整版：'
    Write-Host '    winget install Gyan.FFmpeg'
    Write-Host '    或：pwsh tools/optimize-gif.ps1 <文件> -FFmpegPath "C:\path\to\ffmpeg.exe"'
    Write-Host '  提示：用 ScreenToGif 录制时，它自带的优化器一般已经够用，这个脚本只是可选的后处理。'
    exit 1
}

$files = foreach ($item in $Path) { Get-Item $item -ErrorAction SilentlyContinue }
if (-not $files) { Write-Host "✗ 没有匹配的文件：$($Path -join ', ')" -ForegroundColor Red; exit 1 }

foreach ($file in $files) {
    $target = if ($Overwrite) { $file.FullName } else { Join-Path $file.DirectoryName "$($file.BaseName)-opt.gif" }
    $beforeMb = $file.Length / 1MB

    # 单条 filtergraph 完成两遍调色板：split 出两路，一路 palettegen、一路 paletteuse
    $graph = "fps=$Fps,scale=$Width`:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3"
    & $ffmpeg -y -v error -i $file.FullName -vf $graph $target

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $target)) {
        Write-Host "✗ 优化失败：$($file.Name)" -ForegroundColor Red
        continue
    }

    $afterMb = (Get-Item $target).Length / 1MB
    $saved = if ($beforeMb -gt 0) { [math]::Round((1 - $afterMb / $beforeMb) * 100) } else { 0 }
    Write-Host ("✓ {0}  {1:N2} MB → {2:N2} MB（省 {3}%）→ {4}" -f $file.Name, $beforeMb, $afterMb, $saved, (Split-Path -Leaf $target)) -ForegroundColor Green

    if ($afterMb -gt 5) {
        Write-Host "  ! 仍然超过 5 MB —— 建议缩短时长或把录制区域裁得更小（README 里 < 3 MB 最舒服）" -ForegroundColor Yellow
    }
}
