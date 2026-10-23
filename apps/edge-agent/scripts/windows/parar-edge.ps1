# Para o edge-agent de forma NORMAL (#658). Chamado por parar-edge.cmd.
#
# Antes ele era morto na hora (Terminate), sem rodar nada. Agora:
#   1. mata so o laco que o religa (edge-rodar / iniciar-edge);
#   2. cria dataparar-edge.flag -- o agente ve o arquivo, GRAVA O MODO LIBERADO
#      NA CATRACA (CATRACA_MODO_AO_PARAR) e sai sozinho;
#   3. espera ate 25 s; se nao sair, mata (nunca fica preso aqui).
# A placa guarda uma configuracao so: com o agente parado ela segue a ultima
# gravada, e sem esta etapa seria "entrada bloqueada".
# So ASCII neste arquivo: o PowerShell 5.1 le .ps1 sem BOM na pagina ANSI.

$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$dados = Join-Path $pasta '....data'
New-Item -ItemType Directory -Force $dados | Out-Null
$sinal = Join-Path $dados 'parar-edge.flag'

function Achar($padrao) {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match $padrao -and $_.ProcessId -ne $PID }
}

function Matar($processos) {
  foreach ($p in $processos) { Invoke-CimMethod -InputObject $p -MethodName Terminate | Out-Null }
}

# 1) O laco primeiro: senao ele religa o agente que esta saindo.
Matar (Achar 'edge-rodar|iniciar-edge')

# 2) Parada normal pelo arquivo-sinal.
if (Achar 'dist.main.js') {
  Set-Content -Path $sinal -Value 'parar'
  $limite = (Get-Date).AddSeconds(25)

  while ((Get-Date) -lt $limite -and (Achar 'dist.main.js')) { Start-Sleep -Milliseconds 500 }

  # 3) Nao saiu no prazo: mata. Nunca fica preso aqui.
  $sobrou = Achar 'dist.main.js'
  if ($sobrou) {
    Matar $sobrou
    Write-Host 'O agente nao saiu sozinho em 25 s e foi encerrado a forca: a catraca segue a ultima configuracao.'
  } else {
    Write-Host 'Agente parado. A catraca ficou liberada nos dois sentidos.'
  }
} else {
  Write-Host 'Agente ja estava parado.'
}

Remove-Item -Path $sinal -Force -ErrorAction SilentlyContinue
