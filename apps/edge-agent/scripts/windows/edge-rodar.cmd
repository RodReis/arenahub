@echo off
rem Roda o edge-agent em laco: se ele cair, volta em 5 s (#499).
rem Nao clique neste arquivo -- quem o chama e a tarefa agendada, sem janela.
chcp 65001 >nul
cd /d "%~dp0..\.."
:loop
node dist\main.js >> "data\edge-agent.log" 2>&1
timeout /t 5 /nobreak >nul
goto loop
