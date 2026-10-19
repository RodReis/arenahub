@echo off
rem Roda o edge-agent em laco: se ele cair, volta em 5 s (#499).
rem Nao clique neste arquivo -- quem o chama e a tarefa agendada, sem janela.
chcp 65001 >nul
cd /d "%~dp0..\.."
rem TopFace parado e desativado antes de subir (#642): ele disputa o leitor na 7792.
if exist "%~dp0garantir-sem-topface.cmd" call "%~dp0garantir-sem-topface.cmd" >> "data\edge-agent.log" 2>&1
:loop
rem Rotacao do log (#499): passou de 5 MB na partida, vira .old (so guarda 1).
if exist "data\edge-agent.log" for %%F in ("data\edge-agent.log") do if %%~zF GTR 5242880 move /y "data\edge-agent.log" "data\edge-agent.log.old" >nul
node dist\main.js >> "data\edge-agent.log" 2>&1
timeout /t 5 /nobreak >nul
goto loop
