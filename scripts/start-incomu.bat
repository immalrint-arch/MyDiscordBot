@echo off
rem Starts Incomu and starts it again 10 seconds after any stop or crash.
rem Close this window (or press Ctrl+C twice) to stop the bot for good.
cd /d "%~dp0.."
title Incomu bot
:loop
echo [%date% %time%] Starting Incomu...
node index.js
echo [%date% %time%] Incomu stopped. Restarting in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
