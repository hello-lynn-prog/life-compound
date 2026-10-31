# 注册/取消开机提醒：在 Windows "启动文件夹"里创建/删除快捷方式
# 用法：powershell -File register_reminder.ps1           （注册）
#       powershell -File register_reminder.ps1 -Remove    （取消）
param(
    [switch]$Remove
)
$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "人生复利系统开机提醒.lnk"
$pyw = Join-Path $PSScriptRoot "reminder.pyw"

if ($Remove) {
    if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force; Write-Host "已取消开机提醒" }
    else { Write-Host "本来就没有注册过" }
    exit 0
}

# 快捷方式指向 pythonw.exe（无窗口运行）
$pythonw = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
if (-not $pythonw) {
    # 兜底：从 python.exe 推导 pythonw 路径
    $pythonw = (Get-Command python -ErrorAction Stop).Source -replace "python\.exe$", "pythonw.exe"
}
if (-not (Test-Path $pythonw)) { throw "找不到 pythonw.exe，请确认 Python 已正确安装" }

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $pythonw
$lnk.Arguments = "`"$pyw`""
$lnk.WorkingDirectory = $PSScriptRoot
$lnk.Description = "人生复利系统 · 开机提醒"
$lnk.Save()
Write-Host "开机提醒快捷方式已创建：$lnkPath"
