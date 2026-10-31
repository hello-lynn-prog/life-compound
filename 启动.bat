@echo off
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
