@echo off
taskkill /F /IM app.exe >nul 2>&1
timeout /t 1 /nobreak >nul
cd /d %~dp0
set DATABASE_URL=postgres://pk:pk@127.0.0.1:5437/pk?sslmode=disable
set AUTH_SECRET=dev-pepper
set DEV_CODE=000000
set WEBHOOK_ALLOW_PRIVATE_TARGET=1
app.exe
