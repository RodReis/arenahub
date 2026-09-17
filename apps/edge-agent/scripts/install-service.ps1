<#
.SYNOPSIS
  Instala o edge-agent como servico Windows "ArenaHub Edge" (F59, ADR-011).

.DESCRIPTION
  Servico com inicio automatico e recuperacao em falha. A ponte
  EasyInnerBridge.exe NAO e servico separado -- e processo filho do
  edge-agent (ver adapters/topdata/ponte-easyinner-processo.ts), entao
  morre e nasce com o servico pai, sem entrada propria aqui.

  DECISAO DE CONTA (Task 13, resolve o risco de escopo DPAPI documentado em
  producao/armazenamento-de-credencial.ts): a credencial de pareamento e
  cifrada com DataProtectionScope.CurrentUser (Task 10), que so a MESMA
  conta Windows que cifrou consegue descriptografar depois. Rodar o
  servico como LocalSystem ou como conta de servico dedicada quebraria
  isso, porque o pareamento roda interativo, sob a conta do usuario
  Windows logado -- uma conta diferente da que o servico usaria.

  Por isso este script INSTALA o servico para rodar sob a MESMA conta
  Windows que o executa (o usuario atual), nunca LocalSystem. Isso e
  consistente com o cenario do ADR-011: PC compartilhado da recepcao,
  sem operador dedicado 24/7, sem hardware isolado -- a conta interativa
  que loga na maquina e a mesma que pareia e a mesma que roda o servico.

  IMPORTANTE: o pareamento (que grava credencial.dat em %LOCALAPPDATA%)
  DEVE rodar sob esta MESMA conta, antes ou logo depois desta instalacao.
  Se a maquina tiver mais de uma conta de usuario, use sempre a mesma
  para pareamento e para instalar o servico -- nunca alterne.
#>

param(
    [string]$NomeDoServico = "ArenaHub Edge",
    [string]$CaminhoDoNode = (Get-Command node).Source,
    [string]$CaminhoDoScript = (Join-Path $PSScriptRoot "..\dist\main.js")
)

if (-not (Test-Path $CaminhoDoScript)) {
    Write-Error "dist/main.js nao encontrado em $CaminhoDoScript -- rode 'pnpm build' antes."
    exit 1
}

$servicoExistente = Get-Service -Name $NomeDoServico -ErrorAction SilentlyContinue
if ($servicoExistente) {
    Write-Error "Servico '$NomeDoServico' ja existe. Use uninstall-service.ps1 antes de reinstalar."
    exit 1
}

New-Service `
    -Name $NomeDoServico `
    -BinaryPathName "`"$CaminhoDoNode`" `"$CaminhoDoScript`"" `
    -StartupType Automatic `
    -DisplayName $NomeDoServico

# Conta do servico: a MESMA conta Windows que roda este instalador --
# nunca LocalSystem (ver comentario de topo, risco de escopo DPAPI).
# `sc.exe config obj=` e o unico jeito de setar a conta depois de criado;
# New-Service nao expoe essa opcao. Uma conta de usuario comum (diferente
# de LocalSystem/NetworkService/virtual account) exige senha para receber
# o direito "Logon as a Service" -- o Windows nao aceita em branco. A
# senha e pedida aqui de forma segura (Read-Host -AsSecureString) e
# passada so para sc.exe nesta chamada; nunca gravada em arquivo, log ou
# BinaryPathName.
$contaAtual = "$env:USERDOMAIN\$env:USERNAME"
$senhaSegura = Read-Host -Prompt "Senha da conta Windows '$contaAtual' (necessaria para o servico rodar sob esta conta)" -AsSecureString
$ponteiroSenha = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSegura)
try {
    $senhaTextoClaro = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiroSenha)
    sc.exe config $NomeDoServico obj= $contaAtual password= $senhaTextoClaro
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiroSenha)
    $senhaTextoClaro = $null
}
Write-Host "Servico configurado para rodar como '$contaAtual' (mesma conta do pareamento -- ver DECISAO DE CONTA no topo deste script)."

# Recuperacao em falha: reinicia na 1a e 2a falha, e a cada falha seguinte,
# com 5s de espera. `sc.exe failure` e o unico jeito de configurar isso --
# New-Service nao expoe essa opcao.
sc.exe failure $NomeDoServico reset= 86400 actions= restart/5000/restart/5000/restart/5000

Write-Host "Servico '$NomeDoServico' instalado. Inicie com: Start-Service '$NomeDoServico'"
Write-Host "ATENCAO: se o pareamento ainda nao rodou sob esta conta ($contaAtual), rode-o antes de iniciar o servico -- ver docs/operations/smart-access/install.md."
