@echo off
rem Atualiza o edge-agent: para, baixa, compila e sobe de novo (#499).
rem Enquanto atualiza (~2 min), a catraca fica no modo offline.

rem Roda de uma COPIA: o `cmd` le o arquivo enquanto executa, e o `git pull`
rem abaixo pode reescrever este proprio script no meio do caminho.
if not "%~1"=="--copia" (
  copy /y "%~f0" "%TEMP%\atualizar-edge.cmd" >nul
  "%TEMP%\atualizar-edge.cmd" --copia "%~dp0"
  exit /b
)
set "PASTA=%~2"
cd /d "%PASTA%..\..\..\.."

call "%PASTA%parar-edge.cmd"

git pull
if errorlevel 1 goto erro
call pnpm install --frozen-lockfile
if errorlevel 1 goto erro
call pnpm --filter @arenahub/edge-agent bridge:build
if errorlevel 1 goto erro
call pnpm exec turbo run build --filter=@arenahub/edge-agent
if errorlevel 1 goto erro

schtasks /Run /TN "ArenaHub Edge"
echo.
echo Atualizado e rodando.
pause
exit /b 0

:erro
echo.
echo FALHOU a atualizacao. Subindo o agente com o que ja estava compilado...
schtasks /Run /TN "ArenaHub Edge"
echo Confira o log (ver-log-edge.cmd) e mande a mensagem de erro acima.
pause
exit /b 1
