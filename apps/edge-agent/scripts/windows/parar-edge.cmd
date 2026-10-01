@echo off
rem Para o edge-agent e o laco que o religa (#499). A catraca volta ao modo
rem offline em ~10 s e decide sozinha pela lista dela.
rem Tambem para o lancador antigo (C:\ArenaHub\iniciar-edge.cmd).
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%%edge-rodar%%' OR CommandLine LIKE '%%iniciar-edge%%' OR CommandLine LIKE '%%dist%%main.js%%'\" | Where-Object ProcessId -ne $PID | Invoke-CimMethod -MethodName Terminate | Out-Null"
echo Agente parado. A catraca volta ao modo offline em ~10 s.
