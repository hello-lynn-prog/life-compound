# -*- coding: utf-8 -*-
"""
生成用户入口脚本（GBK 编码的 .bat，Windows 命令行才不会乱码）
用法：python scripts/make_scripts.py
生成：
- life-compound/启动.bat       日常双击启动
- life-compound/首次安装.bat   第一次使用时运行一次
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- 日常启动
START_BAT = r"""@echo off
title 人生复利系统
echo.
echo   ※ 人生复利系统 启动中，请稍候…
echo.

cd /d "%~dp0backend"

rem 已有窗口在运行的话，直接打开浏览器即可
curl -s -o nul http://127.0.0.1:8910/api/health 2>nul
if %errorlevel%==0 (
    echo   检测到系统已在运行，直接打开页面～
    start "" "http://127.0.0.1:8910"
    exit /b 0
)

rem 优先用虚拟环境里的 Python（首次安装.bat 创建），没有就用系统 Python
set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe

echo   [1/2] 启动本地服务（仅本机访问）…
start /b "" %PY% -m uvicorn app.main:app --host 127.0.0.1 --port 8910

echo   [2/2] 等待服务就绪…
set /a tries=0
:waitloop
curl -s -o nul http://127.0.0.1:8910/api/health 2>nul
if %errorlevel%==0 goto ready
set /a tries+=1
if %tries% geq 30 (
    echo   × 服务启动失败：请先运行「首次安装.bat」，或检查 Python 是否已安装
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop

:ready
echo   √ 启动成功！正在打开页面…
start "" "http://127.0.0.1:8910"
echo.
echo   提示：使用期间请保留本窗口；用完直接关掉窗口即可退出。
timeout /t 5 >nul
exit /b 0
"""

# ---------------------------------------------------------------- 首次安装
INSTALL_BAT = r"""@echo off
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
"""

(ROOT / "启动.bat").write_text(START_BAT, encoding="gbk")
(ROOT / "首次安装.bat").write_text(INSTALL_BAT, encoding="gbk")
print("已生成：启动.bat / 首次安装.bat（GBK 编码，无 emoji）")
