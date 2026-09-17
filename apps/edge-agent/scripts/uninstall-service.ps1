<#
.SYNOPSIS
  Remove o servico Windows "ArenaHub Edge" -- preserva data/edge-agent.sqlite
  e a credencial DPAPI (upgrade-rollback.md exige isso).

.DESCRIPTION
  Este script SO remove o registro do servico no Windows (sc.exe delete).
  Ele nao apaga:
  - o SQLite de outbox (data/edge-agent.sqlite) -- guarda a fila de
    eventos que ainda nao subiram; apagar descarta passagem ja registrada
  - o arquivo de credencial cifrada (%LOCALAPPDATA%\ArenaHub\edge-agent\
    credencial.dat) -- reinstalar o servico sob a MESMA conta Windows
    dispensa novo pareamento, porque o DPAPI CurrentUser ainda descriptografa
#>

param([string]$NomeDoServico = "ArenaHub Edge")

$servico = Get-Service -Name $NomeDoServico -ErrorAction SilentlyContinue
if (-not $servico) {
    Write-Warning "Servico '$NomeDoServico' nao existe. Nada a fazer."
    exit 0
}

if ($servico.Status -eq 'Running') {
    Stop-Service -Name $NomeDoServico -Force
}

sc.exe delete $NomeDoServico

Write-Host "Servico '$NomeDoServico' removido. SQLite e credencial preservados (nao apagados por este script)."
