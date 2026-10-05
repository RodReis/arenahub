@echo off
rem Guarda a credencial do GitHub neste PC, uma unica vez, para o
rem `atualizar-edge.cmd` (git pull) parar de pedir login.
rem
rem Use um token SOMENTE LEITURA (fine-grained, so o repo arenahub,
rem Contents: Read-only). Usuario: RodReis. Senha: o token.
rem O token fica no Gerenciador de Credenciais do Windows, nunca no repositorio.

cd /d "%~dp0..\..\..\.."

git config --global credential.helper manager
if errorlevel 1 goto erro

echo.
echo Vai pedir o login do GitHub. Usuario: RodReis. Senha: o token.
echo.
git ls-remote origin HEAD
if errorlevel 1 goto erro

echo.
echo Pronto. O atualizar-edge.cmd nao pede mais senha.
pause
exit /b 0

:erro
echo.
echo FALHOU. Confira o usuario e o token (precisa de Contents: Read-only no repo arenahub).
pause
exit /b 1
