import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executarArquivo = promisify(execFile);

/**
 * Abstrai onde a credencial de pareamento vive -- DPAPI/Credential Manager
 * no Windows (ADR-011), NUNCA arquivo texto. `M0-NFR-005`.
 */
export interface ArmazenamentoDeCredencial {
  salvar(keyId: string, secret: string): Promise<void>;
  carregar(): Promise<{ keyId: string; secret: string } | null>;
  apagar(): Promise<void>;
}

/**
 * Implementacao real -- Windows Credential Manager via DPAPI.
 *
 * DECISAO DE DEPENDENCIA (registrada no PR): `keytar` foi avaliado primeiro,
 * conforme o brief pedia. `pnpm info keytar` mostra 7.9.0 publicado ha mais
 * de um ano no repositorio `atom/node-keytar` -- o projeto Atom foi
 * descontinuado pela GitHub em 2022 e o pacote nao recebe manutencao desde
 * entao (sem prebuilds testados contra ABIs recentes, caindo para
 * compilacao nativa via node-gyp quando o prebuild-install falha). Isso
 * bate com o criterio do brief para pular para a alternativa.
 *
 * Alternativa escolhida: DPAPI via PowerShell
 * (`System.Security.Cryptography.ProtectedData`), gravando o segredo
 * CIFRADO por usuario/maquina em um arquivo no perfil do usuario -- nunca
 * texto puro (`M0-NFR-005`). `cmdkey` (Credential Manager nativo) NAO serve
 * para o caso de uso: ele permite listar/apagar credenciais, mas o Windows
 * nunca devolve o segredo em texto claro por `cmdkey` -- so o processo que
 * gravou (via CredWrite) consegue ler de volta, e no-Node isso exige o
 * mesmo binding nativo que o keytar tentava evitar. DPAPI resolve o mesmo
 * requisito de seguranca (segredo cifrado pela chave da conta do Windows,
 * nunca em texto piano) sem dependencia nativa nenhuma.
 *
 * NAO TESTADA automaticamente: PowerShell + DPAPI so existe no Windows, o
 * CI roda Linux/macOS para esta suite. So a implementacao em memoria abaixo
 * tem teste automatizado; esta classe e verificada manualmente na bancada
 * Windows (ADR-010/011 fixam a plataforma de producao).
 */
export class ArmazenamentoDeCredencialWindows implements ArmazenamentoDeCredencial {
  constructor(private readonly caminhoDoArquivo: string) {}

  async salvar(keyId: string, secret: string): Promise<void> {
    const texto = JSON.stringify({ keyId, secret });

    await this.executarPowerShell(
      `
      $ErrorActionPreference = 'Stop'
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($env:AH_TEXTO_CLARO)
      $protegido = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [System.IO.File]::WriteAllBytes($env:AH_CAMINHO, $protegido)
      `,
      { AH_TEXTO_CLARO: texto, AH_CAMINHO: this.caminhoDoArquivo },
    );
  }

  async carregar(): Promise<{ keyId: string; secret: string } | null> {
    const { stdout } = await this.executarPowerShell(
      `
      $ErrorActionPreference = 'Stop'
      if (-not (Test-Path $env:AH_CAMINHO)) { exit 0 }
      $protegido = [System.IO.File]::ReadAllBytes($env:AH_CAMINHO)
      $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $protegido, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
      `,
      { AH_CAMINHO: this.caminhoDoArquivo },
    );

    if (!stdout) return null;

    return JSON.parse(stdout) as { keyId: string; secret: string };
  }

  async apagar(): Promise<void> {
    await this.executarPowerShell(
      `
      if (Test-Path $env:AH_CAMINHO) { Remove-Item -Force $env:AH_CAMINHO }
      `,
      { AH_CAMINHO: this.caminhoDoArquivo },
    );
  }

  private async executarPowerShell(
    script: string,
    variaveis: Record<string, string>,
  ): Promise<{ stdout: string }> {
    const resultado = await executarArquivo(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...variaveis } },
    );

    return { stdout: resultado.stdout.trim() };
  }
}

/** Implementacao em memoria -- SO para teste. Nunca usada em producao. */
export class ArmazenamentoDeCredencialEmMemoria implements ArmazenamentoDeCredencial {
  private valor: { keyId: string; secret: string } | null = null;

  salvar(keyId: string, secret: string): Promise<void> {
    this.valor = { keyId, secret };
    return Promise.resolve();
  }

  carregar(): Promise<{ keyId: string; secret: string } | null> {
    return Promise.resolve(this.valor);
  }

  apagar(): Promise<void> {
    this.valor = null;
    return Promise.resolve();
  }
}
