@echo off
rem Para o edge-agent e o laco que o religa (#499).
rem Parada NORMAL (#658): o agente grava a catraca como liberada antes de sair,
rem entao a catraca fica livre nos dois sentidos enquanto ele estiver parado.
rem Tambem para o lancador antigo (C:ArenaHubiniciar-edge.cmd).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0parar-edge.ps1"
