import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executarArquivo = promisify(execFile);

/**
 * Lancado por `ArmazenamentoDeCredencialWindows.carregar()` quando o
 * PowerShell/DPAPI falha ao descriptografar um arquivo de credencial
 * EXISTENTE -- tipicamente porque a conta Windows atual nao e a mesma que
 * gravou o arquivo (`DataProtectionScope.CurrentUser`, ver comentario de
 * classe). Mensagem em portugues, sem a stack do PowerShell embutido, para
 * `main.ts` logar algo acionavel em vez do "Command failed: powershell.exe
 * ... <script inteiro>" cru que o Node devolve (F59, achado de revisao 3).
 */
export class CredencialIlegivelError extends Error {
  readonly code = 'EDGE_CREDENCIAL_ILEGIVEL';

  constructor(caminhoDoArquivo: string, causa: unknown) {
    super(
      `A credencial existe em "${caminhoDoArquivo}" mas nao pode ser descriptografada ` +
        '(provavelmente foi cifrada por outra conta Windows -- DPAPI CurrentUser so e legivel ' +
        'pela mesma conta que gravou). Repare rodando novamente sob a MESMA conta que fez o ' +
        'pareamento com EDGE_PAIRING_CODE definido, ou apague o arquivo para forcar novo ' +
        'pareamento.',
      { cause: causa },
    );
    this.name = 'CredencialIlegivelError';
  }
}

/**
 * `ProtectedData` mora em `System.Security.dll`, que NAO vem carregado numa
 * sessao `powershell.exe -NoProfile` (issue #406, achado na instalacao real
 * da Arena Positiva). Sem esta linha, os scripts morrem com "Nao e possivel
 * localizar o tipo [System.Security.Cryptography.ProtectedData]" -- e, no
 * caminho do `salvar`, isso acontece DEPOIS de a nuvem ja ter queimado o
 * codigo de pareamento de uso unico.
 *
 * `System.Security` e o nome do assembly no .NET Framework (PowerShell 5.1
 * Desktop, que e o que roda no PC da recepcao).
 * `System.Security.Cryptography.ProtectedData` -- o nome no .NET Core -- NAO
 * existe la e faz o `Add-Type` falhar com `ASSEMBLY_NOT_FOUND`.
 */
const CARREGAR_SYSTEM_SECURITY = 'Add-Type -AssemblyName System.Security';

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
 *
 * RISCO CONHECIDO -- escopo DPAPI (ver tambem os comentarios em `salvar` e
 * `carregar`): `DataProtectionScope.CurrentUser` amarra a cifra a MESMA
 * conta Windows que a criou. Quando o edge-agent rodar como servico Windows
 * (ADR-011, Task 13 -- ainda nao implementada), se o pareamento acontecer
 * sob uma conta (ex.: instalador rodando interativo) e o servico depois
 * rodar sob outra (ex.: LocalSystem ou conta de servico dedicada),
 * `Unprotect` falha em TODO arranque do servico, com erro DPAPI criptico e
 * sem fallback. A Task 13 precisa decidir DELIBERADAMENTE: (a) garantir que
 * o pareamento roda sob a mesma conta do servico, ou (b) trocar para
 * `DataProtectionScope.LocalMachine` (qualquer conta na mesma maquina
 * descriptografa -- sacrifica isolamento por conta em troca de nao quebrar
 * entre pareamento e servico).
 *
 * SUPOSICAO -- ACL do arquivo: esta classe escreve `caminhoDoArquivo` sem
 * aplicar nenhuma ACL/permissao propria. A protecao vem inteiramente da
 * cifra DPAPI, o que so e seguro se o caminho ja estiver restrito ao
 * perfil da conta que vai rodar o servico (nao world-readable). Quem
 * instancia esta classe (Task 11/13) e responsavel por escolher um caminho
 * ja restrito -- este codigo nao aplica ACL propria.
 */
export class ArmazenamentoDeCredencialWindows implements ArmazenamentoDeCredencial {
  /**
   * `executar` e injetavel SO para teste: sem isso, verificar o script que
   * vai ao PowerShell exigiria rodar o PowerShell -- e o defeito da #406
   * (assembly nao carregado) so aparece numa maquina Windows real, que o CI
   * nao tem. O default e o `execFile` de producao.
   */
  constructor(
    private readonly caminhoDoArquivo: string,
    private readonly executar: typeof executarArquivo = executarArquivo,
  ) {}

  async salvar(keyId: string, secret: string): Promise<void> {
    const texto = JSON.stringify({ keyId, secret });

    await this.executarPowerShell(
      `
      $ErrorActionPreference = 'Stop'
      ${CARREGAR_SYSTEM_SECURITY}
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($env:AH_TEXTO_CLARO)
      # CurrentUser: so a MESMA conta Windows que rodou este 'salvar' consegue
      # descriptografar depois (ver comentario de classe -- risco de escopo
      # DPAPI para a Task 13 / servico Windows).
      $protegido = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [System.IO.File]::WriteAllBytes($env:AH_CAMINHO, $protegido)
      `,
      { AH_TEXTO_CLARO: texto, AH_CAMINHO: this.caminhoDoArquivo },
    );
  }

  async carregar(): Promise<{ keyId: string; secret: string } | null> {
    let stdout: string;

    try {
      ({ stdout } = await this.executarPowerShell(
        `
        $ErrorActionPreference = 'Stop'
        ${CARREGAR_SYSTEM_SECURITY}
        if (-not (Test-Path $env:AH_CAMINHO)) { exit 0 }
        $protegido = [System.IO.File]::ReadAllBytes($env:AH_CAMINHO)
        # CurrentUser: falha com erro DPAPI criptico se a conta que roda este
        # 'carregar' nao for a mesma que rodou 'salvar' (ver comentario de
        # classe -- decisao pendente para a Task 13 / servico Windows).
        $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
          $protegido, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($bytes))
        `,
        { AH_CAMINHO: this.caminhoDoArquivo },
      ));
    } catch (erro: unknown) {
      // O arquivo existe (senao o script teria feito `exit 0` sem erro) mas
      // o Unprotect falhou -- relanca com mensagem acionavel em vez do erro
      // cru do execFile (ver CredencialIlegivelError).
      throw new CredencialIlegivelError(this.caminhoDoArquivo, erro);
    }

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
    const resultado = await this.executar(
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
