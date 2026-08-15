# Compila a ponte EasyInner para x86 (.NET Framework 4.x).
#
# x86 e OBRIGATORIO: a EasyInner.dll e de 32 bits. Um .exe x64 carregando-a
# retorna GPF (codigo 8). Ver docs/vendor/topdata/PROTOCOLO-CATRACA.md.

$ErrorActionPreference = 'Stop'

$csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    throw "csc nao encontrado em $csc -- .NET Framework 4.x ausente?"
}

$binDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force $binDir | Out-Null
$out = Join-Path $binDir 'EasyInnerBridge.exe'
$src = Join-Path $PSScriptRoot 'EasyInnerBridge.cs'

& $csc /platform:x86 /nologo /out:$out `
    /reference:System.Web.Extensions.dll `
    $src

if ($LASTEXITCODE -ne 0) { throw "csc falhou (exit $LASTEXITCODE)" }
Write-Output "OK: $out"
