@echo off
rem Garante que o TopFace (software da Topdata) esta parado e desativado (#642).
rem Ele escuta a mesma porta 7792 do agente: quem atende primeiro fica com o
rem leitor, e o rosto e reconhecido mas a catraca nao libera. Runbook, secao 7.
rem Sem o servico instalado (ou ja desativado) nao faz nada. Nunca aborta quem chama.

powershell -NoProfile -Command "$s = Get-Service TopFaceService -ErrorAction SilentlyContinue; if (-not $s) { exit 0 }; if ($s.Status -eq 'Running' -or $s.StartType -ne 'Disabled') { exit 2 }; exit 0"
if not errorlevel 2 exit /b 0

echo TopFace esta ligado e disputa o leitor com o ArenaHub. Parando e desativando...
echo Se aparecer o aviso do Windows pedindo permissao, clique em Sim.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Stop-Service TopFaceService -Force; Set-Service TopFaceService -StartupType Disabled'"

powershell -NoProfile -Command "$s = Get-Service TopFaceService -ErrorAction SilentlyContinue; if (-not $s -or ($s.Status -ne 'Running' -and $s.StartType -eq 'Disabled')) { exit 0 }; exit 2"
if errorlevel 2 (
  echo ATENCAO: nao consegui desativar o TopFace. Rode como administrador:
  echo   sc.exe stop TopFaceService
  echo   sc.exe config TopFaceService start= disabled
  exit /b 1
)
echo TopFace parado e desativado. Se o leitor nao voltar sozinho, religue-o na tomada.
exit /b 0
