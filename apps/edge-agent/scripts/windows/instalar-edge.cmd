@echo off
rem Instala (ou reinstala) o edge-agent para subir sozinho no login, sem
rem janela (#499). Clique com o botao direito -> Executar como administrador,
rem logado na MESMA conta Windows do pareamento (a credencial e cifrada para
rem essa conta).
net session >nul 2>&1
if errorlevel 1 (
  echo Rode como ADMINISTRADOR: botao direito no arquivo -^> Executar como administrador.
  pause
  exit /b 1
)

call "%~dp0parar-edge.cmd"

schtasks /Create /TN "ArenaHub Edge" /SC ONLOGON /RL HIGHEST /TR "wscript.exe \"%~dp0edge-rodar-oculto.vbs\"" /F
if errorlevel 1 (
  echo Nao foi possivel criar a tarefa agendada.
  pause
  exit /b 1
)

schtasks /Run /TN "ArenaHub Edge"
echo.
echo Pronto: o agente esta rodando sem janela e sobe sozinho a cada login.
echo Para ver o log: ver-log-edge.cmd   Para parar: parar-edge.cmd
pause
