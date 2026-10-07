<#
.SYNOPSIS
    给「官方 Folia 源码」打上本仓库的宿主补丁（tools/folia-local-changes.patch）。

.DESCRIPTION
    README「从源码构建」第 2 步的一键版：
      clone（或复用已有目录）→ git am → 失败自动回退 git apply -3 → 仍失败就列出冲突文件并给出处置提示。
    做完只打补丁，不做 npm install（那一步很慢，按输出里的提示自己跑）。

.EXAMPLE
    pwsh tools/apply-patch.ps1
    pwsh tools/apply-patch.ps1 -FoliaDir D:\folia
    pwsh tools/apply-patch.ps1 -SkipClone      # 目录已存在时跳过 clone 检查
#>
[CmdletBinding()]
param(
    # 目标 Folia 源码目录，默认为本仓库同级的 folia/
    [string]$FoliaDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'folia'),
    [string]$Repo = 'https://github.com/chthollyphile/folia-major',
    [switch]$SkipClone
)

$ErrorActionPreference = 'Stop'
$patch = Join-Path $PSScriptRoot 'folia-local-changes.patch'

function Info($text) { Write-Host "  $text" }
function Ok($text) { Write-Host "✓ $text" -ForegroundColor Green }
function Warn($text) { Write-Host "! $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "✗ $text" -ForegroundColor Red }

Write-Host "`n=== 给 Folia 打宿主补丁 ===" -ForegroundColor Cyan
Info "补丁: $patch"
Info "目标: $FoliaDir"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '找不到 git，请先安装 Git for Windows'; exit 1 }
if (-not (Test-Path $patch)) { Fail "找不到补丁文件：$patch"; exit 1 }

# ---- 1. 目录：存在就用，不存在就 clone
if (Test-Path (Join-Path $FoliaDir 'package.json')) {
    Ok '目录已存在，复用'
} elseif ($SkipClone) {
    Fail "目录不存在且指定了 -SkipClone：$FoliaDir"; exit 1
} else {
    if (Test-Path $FoliaDir) { Fail "目标目录已存在但不是 Folia 源码：$FoliaDir"; exit 1 }
    Info "clone 上游（$Repo）→ $FoliaDir"
    git clone $Repo $FoliaDir
    if ($LASTEXITCODE -ne 0) { Fail 'clone 失败（网络？）'; exit 1 }
    Ok 'clone 完成'
}

Push-Location $FoliaDir
try {
    if (-not (Test-Path '.git')) { Fail "$FoliaDir 不是 git 仓库，无法打补丁"; exit 1 }

    # ---- 2. 工作区必须干净（git am 要求）
    $dirty = git status --porcelain
    if ($dirty) { Fail '工作区有未提交改动，请先处理：'; $dirty | ForEach-Object { Info $_ }; exit 1 }

    # ---- 3. 是否已经打过
    $subjects = git log --format=%s -50
    if ($subjects -match '模组音源的本地扩展') {
        Ok '看起来补丁已经应用过（历史里有本仓库的本地提交），跳过'
    } else {
        Info '应用补丁：git am …'
        git am $patch
        if ($LASTEXITCODE -eq 0) {
            Ok 'git am 成功'
        } else {
            Warn 'git am 失败（多半是上游前进了），回退后改用三方合并 git apply -3'
            git am --abort 2>$null | Out-Null
            git apply -3 $patch
            if ($LASTEXITCODE -eq 0) {
                Ok '三方合并成功 —— 注意：这是工作区改动，需要自己 git commit'
                Info '建议：git add -A; git commit -m "apply bobo-source host patch"'
            } else {
                Fail '三方合并也失败，需要手动处理冲突'
                Write-Host "`n冲突文件：" -ForegroundColor Yellow
                git status --porcelain | ForEach-Object { Info $_ }
                Write-Host @"

处置建议：
  1. 冲突集中在「模组平台的契约与适配层」这几个文件（见 folia-本地改动清单.md 的文件表）；
  2. 以上游结构为准，只把我们那几处增量语义搬过去；
  3. 补丁是按能力分项的（auth / library / albums / recommendations / searchCollections），
     某一项搬不动就先注释掉对应能力，其它能力不受影响
     —— 依赖矩阵见 folia-本地改动清单.md 第三节；
  4. 实在搞不动可以在本仓库开 issue，把 git status 与冲突片段贴上来。
"@
                exit 1
            }
        }
    }

    $head = git rev-parse --short HEAD 2>$null
    $branch = git rev-parse --abbrev-ref HEAD 2>$null
    Info "当前 HEAD：$branch @ $head"
    Write-Host "`n后续步骤（回到本仓库根目录执行）：" -ForegroundColor Cyan
    Write-Host @"
  cd ..
  cd any-listen; npm install; npm run build:cjs; cd ..
  node tools/sync-bodian-vendor.mjs
  node tools/sync-mod-deps.mjs
  tools\start-folia.bat            # 开发运行
  node tools\build-installer.mjs   # 或出安装包
"@
    Ok '完成'
} finally {
    Pop-Location
}
