@echo off
rem Mostra o log do edge-agent ao vivo (#499). Fechar esta janela NAO para
rem o agente -- so a visualizacao.
chcp 65001 >nul
powershell -NoProfile -Command "Get-Content -Encoding UTF8 '%~dp0..\..\data\edge-agent.log' -Wait -Tail 30"
