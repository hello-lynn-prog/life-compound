@echo off
title 人生复利系统 · 首次安装
echo.
echo   =========================================
echo    人生复利系统 · 首次安装（只需运行一次）
echo   =========================================
echo.

cd /d "%~dp0backend"

echo   [1/3] 检查 Python…
python --version >nul 2>nul
if not %errorlevel%==0 (
    echo   × 没有检测到 Python。请先到 python.org 下载安装 Python 3.10+，
    echo     安装时务必勾选 "Add Python to PATH"，然后重新运行本脚本。
    pause
    exit /b 1
)
python --version

echo.
echo   [2/3] 创建独立运行环境并安装依赖（约 1-2 分钟，走国内镜像）…
python -m venv .venv
.venv\Scripts\python.exe -m pip install -q --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
.venv\Scripts\python.exe -m pip install -q -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if not %errorlevel%==0 (
    echo   × 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
)

echo.
echo   [3/3] 是否注册"开机提醒"？（开机后若今天还没写任务，会弹 Windows 通知）
choice /c YN /m "注册开机提醒请按 Y，跳过请按 N"
if %errorlevel%==1 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register_reminder.ps1"
    echo   √ 开机提醒已注册
) else (
    echo   已跳过（之后想开启可重新运行本脚本）
)

echo.
echo   =========================================
echo    安装完成！以后每天双击项目根目录的「启动.bat」即可使用
echo   =========================================
echo.
pause
