@echo off
rem Dev-only launcher (for daily use, run start.bat in project root)
cd /d "%~dp0..\backend"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8910
