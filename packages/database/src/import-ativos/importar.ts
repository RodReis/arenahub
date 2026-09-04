/**
 * Nucleo da importacao da base CORRENTE do Pacto -- F48.
 *
 * Separado do script CLI (`prisma/seed-ativos.ts`) pelo mesmo motivo da F47:
 * assim a gravacao e testavel com um client injetado, sem depender de
 * `process.env` nem de arquivo em disco. O script le o arquivo, resolve
 * tenant/plano/unidade e imprime relatorio; a decisao do que gravar mora
 * aqui.
 *
 * A F47 trouxe os 1.926 historicos como `CANCELLED`, sem direito de acesso.
 * Esta fatia traz quem treina HOJE: atualiza o cadastro, grava a credencial
 * do leitor, vincula o plano e -- so entao -- concede o `Entitlement`.
 *
 * REGRAS QUE ESTE ARQUIVO NAO PODE VIOLAR:
 *
 *   - Idempotencia (regra de arquitetura no 4): toda escrita e upsert ou
 *     leitura-antes-de-criar por chave natural. Rodar duas vezes produz o
 *     mesmo banco.
 *   - So `Entitlement` decide acesso (regra no 1). Ativar cadastro NAO e dar
 *     acesso: aluno sem periodo de plano fica ACTIVE e SEM direito.
 *   - `tenantId` em toda entidade de negocio (regra no 2).
 *   - NENHUMA `Invoice`. Vincular plano nao e cobrar -- essas pessoas ja
 *     pagaram no sistema antigo.
 *   - NENHUMA `BiometricIdentity` nem `ConsentRecord` (regra no 7). O numero
 *     do leitor entra como `StudentCredential`, que e identificador de
 *     equipamento; biometria exige consentimento e nao e escopo desta fatia.
 *   - Campo vazio no arquivo NAO apaga dado existente no banco.
 *
 * O QUE MUDOU NA F49: quem nao casa com o cadastro DEIXOU de virar pendencia
 * e passa a ser CADASTRADO. Investigacao do PI sobre a rodada real (347
 * linhas, 284 casadas, 49 nao encontradas) mostrou que os 49 nao eram
 * casamento perdido por grafia -- nome parecido e CPF foram conferidos no
 * banco, nenhum bate. Sao pessoas que o import historico (F47) nunca trouxe.
 * Deixa-las de fora significaria a catraca fechada para 49 pessoas que
 * treinam hoje.
 *
 * O que a F49 NAO afrouxou:
 *   - `AMBIGUO` continua pendencia. Nao encontrar ninguem e uma coisa;
 *     escolher entre dois candidatos e outra, e essa o seed nunca faz.
 *   - Idempotencia: quem foi criado na primeira execucao CASA na segunda,
 *     porque a criacao entra na lista de candidatos em memoria e persiste
 *     no banco para a proxima leitura.
 */
import type { PrismaClientArenaHub } from '../client.js';
import {
  calcularHashDeCpf,
  cpfEhValido,
  decidirCasamento,
  formatarMatricula,
  nascimentoEhPlausivel,
  normalizarCpf,
  normalizarNome,
  origemDoDireito,
  parsearDataDoPacto,
  traduzirPerfil,
  type CandidatoDeAluno,
  type PerfilImportado,
} from './dominio.js';

/**
 * Meses de validade do direito por VINCULO (ADMIN, STAFF, TRAINER).
 *
 * O arquivo do Pacto nao traz periodo para quem nao e aluno. Doze meses
 * forca revalidacao anual: quem sai da academia perde o acesso sozinho, sem
 * depender de alguem lembrar de revogar.
 */
export const MESES_DE_VINCULO = 12;

/**
 * Data de inicio forcada para quem esta fatia CRIA (nao casa com ninguem).
 *
 * Decisao do PI, 04/09/2026: o Pacto antigo trazia `Data Inicio` de quando a
 * pessoa comecou LA -- por vezes anos atras. Quem nunca existiu no ArenaHub
 * comeca a contar o plano a partir de HOJE da migracao, nao da data historica
 * do sistema antigo. So se aplica a CRIADOS: quem ja tem cadastro (casou)
 * mantem a data que a `gravarPessoa` ja gravava, do arquivo.
 */
const INICIO_PARA_CRIADOS = new Date(Date.UTC(2026, 8, 1));

/**
 * Texto gravado em `Subscription.lastReason` / `Entitlement.reason` de quem
 * foi CRIADO por esta importacao (nao casou).
 *
 * NECESSARIO PARA A IDEMPOTENCIA: a segunda execucao encontra a mesma
 * pessoa por CPF/nome (casamento, nao criacao), e o `inicio` recalculado a
 * partir do CSV e OUTRO valor -- diferente do `INICIO_PARA_CRIADOS` gravado
 * na primeira execucao. Sem este marcador, a busca por `startsAt` exato
 * erraria e uma SEGUNDA assinatura/direito nasceria para a mesma pessoa a
 * cada execucao. Motivo por que nao e so um texto livre feito na hora: tem
 * de ser byte a byte igual em toda execucao para a busca reconhecer.
 */
const MARCADOR_CRIADO = 'Importacao da base ativa do Pacto (F48) -- cadastro novo';

/**
 * UF quando o arquivo nao traz nenhuma. A academia e de Goias (F47/ADR-033).
 *
 * DEIXOU DE SER FIXA em 02/09/2026, por decisao do PI: o export atual traz a
 * coluna `Uf` preenchida, e ignora-la gravava `GO` em quem mora em outro
 * estado. `normalizarUf` cuida do lixo historico (`g`, `Go`, vazio) que
 * motivou o valor fixo original -- o que nao vier como sigla de duas letras
 * cai neste padrao, em vez de gravar sujeira.
 */
const UF_PADRAO = 'GO';

/**
 * Sigla de UF em caixa alta, ou `null` quando o arquivo nao traz uma valida.
 *
 * DUAS LETRAS, e nada mais: o Pacto guarda `g`, `Go`, `goias` e vazio no
 * mesmo campo. Gravar qualquer um deles como veio produziria uma coluna de
 * estado com quatro grafias para o mesmo lugar -- e quem filtrasse por `GO`
 * perderia parte da base sem ver que perdeu.
 */
function normalizarUf(valor: string): string | null {
  const sigla = valor.trim().toUpperCase();

  return /^[A-Z]{2}$/.test(sigla) ? sigla : null;
}

/** Municipio assumido quando o arquivo nao traz -- a unidade fica em Trindade. */
const MUNICIPIO_PADRAO = 'Trindade';

/**
 * Nascimento de quem e cadastrado sem data no arquivo (F49).
 *
 * `Student.birthDate` e NOT NULL e nao ha data para gravar -- sao 3 linhas
 * do arquivo real. A escolha do PI foi cadastrar com marcador em vez de
 * deixar a pessoa de fora.
 *
 * 1900-01-01 e IMPOSSIVEL de proposito: `nascimentoEhPlausivel` recusa
 * qualquer coisa acima de 110 anos, entao ninguem digita isso por engano e
 * ninguem confunde com data real. E toda linha assim vira pendencia
 * `cadastrado sem data de nascimento` -- data falsa que ninguem consegue
 * distinguir de data real e exatamente o que nao pode acontecer calado.
 */
const NASCIMENTO_PLACEHOLDER = new Date(Date.UTC(1900, 0, 1));

/**
 * A data gravada e o placeholder -- ou seja, "nao sabemos o nascimento"?
 *
 * Compara por VALOR (`getTime`), nunca por identidade: o `Date` que volta do
 * banco e outro objeto, e `===` seria sempre `false` -- um aviso que nunca
 * dispara e pior que aviso nenhum, porque parece que alguem cuidou.
 *
 * `birthDate` e `@db.Date` (sem hora nem fuso), entao a comparacao e exata e
 * nao precisa de tolerancia.
 */
function ehNascimentoPlaceholder(nascimento: Date): boolean {
  return nascimento.getTime() === NASCIMENTO_PLACEHOLDER.getTime();
}

/**
 * Espelho de `normalizarTelefone` de
 * `apps/api/src/modules/students/domain/identificacao.ts`. Copia deliberada
 * por FRONTEIRA DE PACOTE: `packages/database` tem `rootDir: "."` no
 * `tsconfig.json` e nao alcanca `apps/api` no typecheck. Mesma nota que
 * `dominio.ts` ja carrega para `normalizarCpf`.
 */
function normalizarTelefone(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Uma linha do relatorio de pessoas ativas do Pacto, ja com nome de campo em
 * ingles.
 *
 * Todos os campos sao `string` porque e assim que o extrator entrega -- data
 * como texto, codigo de perfil como texto. Converter no tipo esconderia o
 * formato do Pacto; quem converte e valida e `dominio.ts`.
 */
export interface RegistroDePessoaAtiva {
  readonly nome: string;
  readonly cartao: string;
  readonly identificadorFacial: string;
  readonly codigoPerfil: string;
  readonly dataNascimento: string;
  readonly endereco: string;
  readonly bairro: string;
  readonly cep: string;
  readonly municipio: string;
  /** Sigla do estado. Vazia ou invalida cai em `UF_PADRAO` -- ver `normalizarUf`. */
  readonly uf: string;
  readonly telefone: string;
  readonly celular: string;
  readonly cpf: string;
  readonly dataInicio: string;
  readonly dataFim: string;
  readonly email: string;
}

/** Motivo pelo qual uma linha nao virou (ou virou so em parte) cadastro ativo. */
export type MotivoDePendencia =
  | 'perfil desconhecido'
  | 'mais de um candidato no cadastro'
  | 'cadastrado sem data de nascimento'
  | 'duplicata dentro do arquivo'
  | 'nascimento implausivel'
  | 'aluno sem periodo de plano'
  | 'credencial ja pertence a outro aluno'
  | 'bloqueado no ArenaHub, veio como ativo no arquivo'
  | 'arquivado no ArenaHub, veio como ativo no arquivo'
  | 'erro ao gravar';

export interface Pendencia {
  readonly nome: string;
  readonly motivo: MotivoDePendencia;
  /** So em `erro ao gravar`: a mensagem, para o operador saber o que houve. */
  readonly detalhe?: string;
}

/**
 * Quantos dos GRAVADOS (casados + criados) tinham cada campo. Ver a nota em
 * `ResultadoDaAtivacao`.
 */
export interface PreenchimentoPorCampo {
  nascimento: number;
  cartao: number;
  facial: number;
  telefone: number;
  email: number;
  endereco: number;
}

/**
 * O que a execucao fez, em numero.
 *
 * O `preenchimento` NAO e enfeite: foi um `logradouro 0/1934` que denunciou
 * um extrator quebrado na F47. Importacao que so diz "sucesso" e como dado
 * vira lixo sem ninguem perceber.
 */
export interface ResultadoDaAtivacao {
  /** Linhas lidas do arquivo, antes de qualquer filtro. */
  lidos: number;
  /** Linhas descartadas por serem registro de teste do Pacto. */
  descartados: number;
  /** Linhas que casaram com um aluno ja cadastrado. */
  casados: number;
  /**
   * Linhas que nao casaram com ninguem e viraram cadastro NOVO (F49).
   *
   * Separado de `casados` de proposito: na segunda execucao este numero cai
   * a zero e `casados` sobe -- e essa e a leitura que prova a idempotencia
   * no relatorio, sem consultar o banco.
   */
  criados: number;
  /** Casados por CPF valido e unico -- o casamento forte. */
  casadosPorCpf: number;
  /** Casados por nome normalizado unico -- o casamento fraco. */
  casadosPorNome: number;
  /** Casados que terminaram com direito por plano / por vinculo. */
  direitosPorPlano: number;
  direitosPorVinculo: number;
  preenchimento: PreenchimentoPorCampo;
  pendencias: Pendencia[];
}

export interface AlvoDaAtivacao {
  readonly tenantId: string;
  readonly planId: string;
  readonly planName: string;
  /** Unidades do tenant. Vira `gymUnitIds` do snapshot congelado. */
  readonly gymUnitIds: readonly string[];
}

/**
 * Registro de teste do Pacto: nome vazio, nome que e so numero, ou marcador
 * de POC. Ativar essas linhas daria acesso a alguem que nao existe.
 */
export function ehRegistroDeTeste(nome: string): boolean {
  const limpo = nome.trim();

  return limpo === '' || /^\d+$/.test(limpo) || limpo.toLowerCase().startsWith('teste');
}

type JanelaDoSnapshot = {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

/**
 * Copia congelada da politica, gravada em `Entitlement.policySnapshot`.
 *
 * `type` e nao `interface`, e sem `readonly` nos arrays, para satisfazer o
 * `InputJsonObject` do Prisma -- ele exige assinatura de indice implicita
 * (que `interface` nao gera) e recusa array somente-leitura. Nao e
 * preferencia de estilo: `interface` aqui nao compila na coluna `Json`.
 */
type SnapshotDePolitica = {
  planId: string | null;
  planName: string;
  snapshotVersion: 1;
  gymUnitIds: string[];
  janelas: JanelaDoSnapshot[];
};

/**
 * Copia congelada da politica, com JANELA LIVRE em todas as unidades.
 *
 * AS LINHAS DE JANELA NAO SAO DECORACAO -- ELAS SAO A UNICA FONTE DAS
 * UNIDADES ONDE O DIREITO VALE. `AccessProjectionRepository` monta
 * `unitIds` exclusivamente a partir de `EntitlementUnitWindow`
 * (`access-projection.repository.ts`: `[...new Set(unitWindows.map((j) =>
 * j.gymUnitId))]`), e `evaluate-access.ts` nega com `WRONG_UNIT` quando
 * `unitIds` nao contem a unidade da catraca. Direito sem janela =
 * `unitIds: []` = TODO MUNDO NEGADO, com a razao mais confusa possivel
 * numa academia de uma unidade so.
 *
 * (Janela VAZIA de fato significa "sem restricao de HORARIO" -- e o que
 * `dentroDeAlgumaJanela` faz com lista vazia. Mas o horario e o passo 6 do
 * motor; a UNIDADE e o passo 5, e nele nao existe fallback. Foi essa
 * meia-verdade que produziu o defeito.)
 *
 * Por isso PLANO e VINCULO usam o MESMO construtor: a diferenca entre eles
 * e so a identidade do plano, e ter dois construtores foi o que permitiu um
 * sair sem janela. Sete dias, do minuto zero ao 1440 -- a base do Pacto nao
 * traz grade de horario, e inventar uma negaria acesso que a pessoa ja tem
 * hoje. Funcionario que abre as 5h e professor que fecha as 23h tambem nao
 * cabem numa grade comercial.
 *
 * Mesma forma que `montarSnapshotDePolitica` produz em
 * `apps/api/src/modules/membership/domain/entitlement.ts`. Replicada, e nao
 * importada, pela FRONTEIRA DE PACOTE explicada no topo do arquivo.
 *
 * ---------------------------------------------------------------------------
 * O EIXO DE `dayOfWeek` E 0..6 (DOMINGO = 0). NAO "CORRIJA" PARA ISO 1..7.
 * ---------------------------------------------------------------------------
 *
 * `0 = domingo ... 6 = sabado`, o eixo de `Date.getDay()` que o MOTOR DE
 * DECISAO consome: `resolverHoraLocal` mapeia `Sun: 0` em
 * `packages/access-policy/src/local-time.ts`, e `AccessWindow.dayOfWeek` em
 * `types.ts` documenta o mesmo. O eixo e do motor porque e o motor que decide
 * se a porta abre.
 *
 * HISTORICO, que explica por que este bloco existe: quando a F48 foi escrita,
 * o resto do sistema gravava ISO-8601 (`1 = segunda ... 7 = domingo`) e so o
 * motor lia 0..6. A F48 seguiu o motor de proposito e deixou a divergencia
 * para um card proprio -- a #129, fechada em 21/08/2026, que unificou todo o
 * repositorio neste eixo e travou a faixa por CHECK no banco.
 *
 * Entao NAO existe mais divergencia a preservar aqui: este bloco continua
 * como aviso porque ISO 1..7 e a convencao mais comum em outros sistemas, e
 * "consertar" para ela produz um defeito que so aparece no DOMINGO -- de
 * segunda a sabado os eixos coincidem (1..6 existe nos dois) e a semana
 * inteira funciona por coincidencia.
 *
 * Ha teste que prova este eixo perguntando ao motor de verdade, num DOMINGO,
 * se a porta abre (`test/import-ativos.int-spec.ts`).
 */
export function montarSnapshot(
  plano: { id: string; name: string } | null,
  perfil: PerfilImportado,
  gymUnitIds: readonly string[],
): SnapshotDePolitica {
  const unidades = [...gymUnitIds].sort();

  const janelas: JanelaDoSnapshot[] = unidades.flatMap((gymUnitId) =>
    // 0..6, eixo do motor -- ver o bloco acima antes de mexer.
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      gymUnitId,
      dayOfWeek,
      startMinute: 0,
      endMinute: 1440,
    })),
  );

  return {
    planId: plano?.id ?? null,
    planName: plano?.name ?? `Vinculo ${perfil}`,
    snapshotVersion: 1,
    gymUnitIds: unidades,
    janelas,
  };
}

/**
 * So os delegates que a gravacao usa -- o teste injeta o client inteiro.
 *
 * `$executeRaw` / `$queryRaw` entraram na F49: a matricula sai do contador
 * `student_sequences` com `SELECT ... FOR UPDATE`, e o Prisma nao expoe
 * lock de linha pelo client tipado.
 */
type Escritor = Pick<
  PrismaClientArenaHub,
  | 'student'
  | 'studentCredential'
  | 'studentContact'
  | 'studentAddress'
  | 'subscription'
  | 'entitlement'
  | 'entitlementUnitWindow'
  | '$executeRaw'
  | '$queryRaw'
>;

/**
 * Proxima matricula do tenant, DENTRO da transacao recebida.
 *
 * Copia do padrao de `StudentRepository.proximaMatricula`
 * (`apps/api/src/modules/students/student.repository.ts`), pela mesma
 * fronteira de pacote das funcoes de CPF -- e pelo mesmo motivo de sempre:
 * `packages/database` nao alcanca `apps/api` no typecheck.
 *
 * `ON CONFLICT DO NOTHING` cria a linha do contador sem corrida; o
 * `SELECT ... FOR UPDATE` serializa as emissoes concorrentes na linha do
 * contador, e nao na tabela `students`. O lock NAO e teatro: sem ele duas
 * transacoes leriam o mesmo `next_value` e a segunda quebraria no UNIQUE de
 * `membership_number` -- a pessoa viraria `erro ao gravar` em vez de entrar.
 *
 * Alternativas descartadas sao as mesmas do original: `COUNT(*) + 1` reusa
 * numero apos arquivamento (quebra INV-010); fragmento de UUID colide e nao
 * e sequencial; `SEQUENCE` do Postgres e global e vazaria volume entre
 * tenants.
 *
 * ---------------------------------------------------------------------------
 * O CONTADOR SOZINHO NAO BASTA -- ELE PODE ESTAR ATRAS DO QUE JA EXISTE.
 * ---------------------------------------------------------------------------
 *
 * Defeito real da rodada de 04/09/2026 contra producao: 30 cadastros novos
 * morreram em `Unique constraint failed on (tenant_id, membership_number)`.
 * `student_sequences` e a unica fonte da matricula, mas NADA garante que ele
 * esteja a frente de `students` -- um import anterior que gravou matricula
 * sem passar pelo contador, uma restauracao de backup, ou um tenant criado
 * por outro caminho deixam o contador para tras, e ele emite um numero que
 * outro aluno ja tem.
 *
 * E NAO SE RECUPERA SOZINHO: cada pessoa roda na sua transacao, e o `UPDATE`
 * do contador e revertido junto com o `create` que falhou. O contador nem
 * avanca, entao a pessoa seguinte tenta exatamente o mesmo numero -- em
 * producao as 30 tentativas colidiram todas no mesmo valor, e o mesmo
 * aconteceria com as 300 seguintes.
 *
 * Por isso o piso vem do MAIOR SUFIXO JA GRAVADO, comparado dentro do mesmo
 * lock. O sufixo e global por tenant (o contador nao reinicia por ano e o
 * UNIQUE nao olha o prefixo), entao a comparacao ignora o `AP-{ano}-` e le
 * so os 8 digitos finais.
 *
 * `membership_number` e `String` livre no schema, sem CHECK de formato, e a
 * base TEM matricula fora do padrao -- o legado do Pacto usa `LEGADO-<hex>`
 * (ver `students-cadastro-completo.int-spec.ts`). Por isso o `substring` com
 * a ancora do formato COMPLETO (`^AP-{4}-{8}$`) em vez de "os 8 ultimos
 * digitos": o que nao casa vira `NULL` e o `MAX` ignora.
 *
 * As duas alternativas testadas e descartadas:
 *   - filtrar por regex no `WHERE` e converter no `SELECT`: o Postgres nao
 *     garante avaliar o filtro antes da agregacao, entao uma linha estranha
 *     derruba a consulta -- e o import junto -- conforme o plano escolhido;
 *   - limpar nao-digitos de `RIGHT(...,8)`: um `LEGADO-1a2b3c4d` cujo hex
 *     caia todo em digitos viraria 12.345.678 e o contador saltaria uma
 *     faixa inteira de matriculas por causa de UMA linha de legado.
 */
async function proximaMatricula(db: Escritor, tenantId: string, ano: number): Promise<string> {
  await db.$executeRaw`
    INSERT INTO student_sequences (tenant_id, next_value, updated_at)
    VALUES (${tenantId}::uuid, 1, now())
    ON CONFLICT (tenant_id) DO NOTHING
  `;

  const travadas = await db.$queryRaw<{ next_value: number }[]>`
    SELECT next_value FROM student_sequences
    WHERE tenant_id = ${tenantId}::uuid
    FOR UPDATE
  `;

  // DENTRO DO LOCK, e nao antes: o `FOR UPDATE` acima serializa as emissoes
  // concorrentes, e ler o maior sufixo fora dele deixaria duas transacoes
  // enxergarem o mesmo piso.
  const maiores = await db.$queryRaw<{ maior: number | null }[]>`
    SELECT MAX(CAST(substring(membership_number from '^AP-[0-9]{4}-([0-9]{8})$') AS INTEGER))
      AS maior
    FROM students
    WHERE tenant_id = ${tenantId}::uuid
  `;

  const contador = travadas[0]?.next_value ?? 1;
  const maiorGravado = maiores[0]?.maior ?? 0;
  // O piso e o MAIOR dos dois. Com o contador a frente (o caso normal), nada
  // muda; com ele atras, salta para depois da ultima matricula real em vez
  // de emitir um numero ja ocupado.
  const sequencial = Math.max(contador, maiorGravado + 1);

  await db.$executeRaw`
    UPDATE student_sequences
    SET next_value = ${sequencial + 1}, updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid
  `;

  return formatarMatricula(ano, sequencial);
}

/** O que a criacao de uma pessoa nova produziu -- o laco traduz em pendencia. */
interface PessoaCriada {
  readonly studentId: string;
  /** `true` quando o nascimento veio do placeholder, nao do arquivo. */
  readonly nascimentoPlaceholder: boolean;
}

/**
 * Cadastra quem o arquivo traz e o cadastro nao tem (F49).
 *
 * SO CRIA A LINHA MINIMA de `Student`. Credencial, contato, endereco, plano
 * e direito continuam saindo de `gravarPessoa`, que roda logo depois: quem
 * e criado recebe EXATAMENTE o mesmo tratamento de quem casou, e nao um
 * caminho paralelo que diverge na proxima fatia.
 *
 * `gymUnitId` e a PRIMEIRA unidade do tenant. E unidade de ORIGEM, nao
 * controle de acesso (ver o comentario da coluna no schema) -- quem decide
 * onde a pessoa entra continua sendo `EntitlementUnitWindow`. A academia
 * opera uma unidade so; com mais de uma, o arquivo do Pacto nao traz de qual
 * unidade a pessoa e, e a primeira e um chute honesto e corrigivel na
 * recepcao, ao contrario de nao cadastrar.
 */
async function criarPessoa(
  db: Escritor,
  alvo: AlvoDaAtivacao,
  registro: RegistroDePessoaAtiva,
  // So `agora`: o PERFIL nao entra aqui de proposito. Quem grava `profile` e
  // `status` e `gravarPessoa`, na mesma transacao, logo em seguida -- receber
  // o perfil sem usa-lo sugeriria que esta funcao decide o papel da pessoa.
  contexto: { agora: Date },
): Promise<PessoaCriada> {
  const gymUnitId = alvo.gymUnitIds[0];

  if (gymUnitId === undefined) {
    // Sem unidade nao ha `Student` possivel (coluna NOT NULL). Falhar aqui
    // vira pendencia `erro ao gravar` da linha, e nao um cadastro invalido.
    throw new Error('Tenant sem unidade: nao ha `gymUnitId` para o cadastro novo.');
  }

  const nascimentoDoArquivo = parsearDataDoPacto(registro.dataNascimento);
  const nascimentoBom =
    nascimentoDoArquivo !== null && nascimentoEhPlausivel(nascimentoDoArquivo, contexto.agora);

  const cpf = normalizarCpf(registro.cpf);
  // CPF invalido NAO e gravado: `cpfEhValido` e o mesmo criterio que
  // `decidirCasamento` usa para casar. Gravar um CPF que o casamento ignora
  // produziria uma coluna que parece identificador e nao identifica nada.
  const cpfBom = cpf !== '' && cpfEhValido(cpf);

  const membershipNumber = await proximaMatricula(
    db,
    alvo.tenantId,
    contexto.agora.getUTCFullYear(),
  );

  const criado = await db.student.create({
    data: {
      tenantId: alvo.tenantId,
      gymUnitId,
      membershipNumber,
      fullName: registro.nome.trim(),
      birthDate: nascimentoBom ? nascimentoDoArquivo : NASCIMENTO_PLACEHOLDER,
      // `cpf` e `cpfHash` andam JUNTOS -- hash sem o campo em claro esconde
      // o dado, campo sem hash quebra a busca por duplicata.
      cpf: cpfBom ? cpf : null,
      cpfHash: cpfBom ? calcularHashDeCpf(alvo.tenantId, cpf) : null,
      // Status e perfil sao responsabilidade de `gravarPessoa`, que roda em
      // seguida na MESMA transacao. `LEAD` (o default do schema) e o estado
      // correto de quem ainda nao foi ativado -- e se a transacao morrer no
      // meio, nao sobra ninguem `ACTIVE` sem direito.
    },
    select: { id: true },
  });

  return { studentId: criado.id, nascimentoPlaceholder: !nascimentoBom };
}

/**
 * Grava a credencial do leitor.
 *
 * A chave natural e `(tenantId, kind, externalId)` -- o indice unico do
 * schema, que existe porque dois alunos dividindo o mesmo numero seria a
 * catraca abrindo para a pessoa errada.
 *
 * `null` = o arquivo nao trouxe numero. `false` = o numero ja pertence a
 * OUTRO aluno, e a linha vira pendencia em vez de roubar a credencial:
 * reatribuir calado trocaria o dono de um cartao sem ninguem ver.
 */
async function gravarCredencial(
  db: Escritor,
  tenantId: string,
  studentId: string,
  kind: 'TURNSTILE_CARD' | 'FACIAL_ENROLL_ID',
  valor: string,
): Promise<boolean | null> {
  const externalId = valor.trim();

  if (externalId === '') return null;

  const existente = await db.studentCredential.findUnique({
    where: { tenantId_kind_externalId: { tenantId, kind, externalId } },
    select: { studentId: true },
  });

  if (existente) return existente.studentId === studentId;

  await db.studentCredential.create({ data: { tenantId, studentId, kind, externalId } });

  return true;
}

/**
 * Grava contato, sem duplicar e sem apagar.
 *
 * Idempotencia por leitura previa em `(studentId, type, value)`: o schema
 * nao tem indice unico ai de proposito (o aluno pode ter dois telefones),
 * entao a chave natural e o proprio trio, conferido antes de criar.
 */
async function gravarContato(
  db: Escritor,
  tenantId: string,
  studentId: string,
  type: 'PHONE' | 'WHATSAPP' | 'EMAIL',
  valor: string,
): Promise<boolean> {
  const cru = valor.trim();

  if (cru === '') return false;
  // E-mail sem arroba nao e e-mail. O Pacto guarda lixo nesse campo ("nao
  // tem", "-"), e gravar isso encheria a base de contato que nunca recebe
  // nada -- e depois some no meio dos contatos bons.
  if (type === 'EMAIL' && !cru.includes('@')) return false;

  const value = type === 'EMAIL' ? cru.toLowerCase() : normalizarTelefone(cru);

  if (value === '') return false;

  const existente = await db.studentContact.findFirst({
    where: { studentId, type, value },
    select: { id: true },
  });

  if (!existente) {
    await db.studentContact.create({
      data: { tenantId, studentId, type, value, isPrimary: false },
    });
  }

  return true;
}

/**
 * Cria o direito com as janelas do snapshot.
 *
 * As janelas vao para `EntitlementUnitWindow` ALEM do snapshot: o motor de
 * decisao le a tabela, e o snapshot e a copia congelada para auditoria. Sem
 * as linhas, o direito existe no banco e a catraca continua fechada.
 */
async function criarDireito(
  db: Escritor,
  dados: {
    tenantId: string;
    studentId: string;
    source: 'SUBSCRIPTION' | 'EMPLOYEE' | 'PERSONAL_TRAINER';
    subscriptionId: string | null;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    snapshot: SnapshotDePolitica;
  },
): Promise<void> {
  const direito = await db.entitlement.create({
    data: {
      tenantId: dados.tenantId,
      studentId: dados.studentId,
      source: dados.source,
      subscriptionId: dados.subscriptionId,
      status: 'ACTIVE',
      startsAt: dados.startsAt,
      endsAt: dados.endsAt,
      reason: dados.reason,
      // O tipo do snapshot e nosso e ate mais estrito que `InputJsonValue`,
      // que exige assinatura de indice; a conversao so declara isso ao
      // compilador. `{ ... }` literal (como em `seed-demo.ts`) passaria
      // direto, ao custo de perder o tipo nomeado.
      policySnapshot: { ...dados.snapshot },
    },
    select: { id: true },
  });

  if (dados.snapshot.janelas.length > 0) {
    await db.entitlementUnitWindow.createMany({
      data: dados.snapshot.janelas.map((janela) => ({ entitlementId: direito.id, ...janela })),
    });
  }
}

/** O que a gravacao de UMA pessoa produziu -- o laco traduz em contador. */
interface EfeitoDaPessoa {
  nascimento: boolean;
  nascimentoImplausivel: boolean;
  cartao: boolean;
  facial: boolean;
  credencialDeOutroAluno: boolean;
  telefone: boolean;
  email: boolean;
  endereco: boolean;
  semPeriodoDePlano: boolean;
  direitoDePlanoCriado: boolean;
  direitoDeVinculoCriado: boolean;
}

/**
 * Grava UMA pessoa, inteira. Roda dentro de uma transacao (ver o laco).
 *
 * Nao empurra pendencia nem incrementa contador: devolve o que aconteceu e
 * deixa o laco traduzir. Assim um `rollback` nao deixa contador contando o
 * que o banco desfez.
 */
async function gravarPessoa(
  db: Escritor,
  alvo: AlvoDaAtivacao,
  registro: RegistroDePessoaAtiva,
  contexto: {
    studentId: string;
    perfil: PerfilImportado;
    agora: Date;
    /** `true` para quem ESTA EXECUCAO criou -- ver `INICIO_PARA_CRIADOS`. */
    criadoNestaExecucao: boolean;
  },
): Promise<EfeitoDaPessoa> {
  const { studentId, perfil, agora, criadoNestaExecucao } = contexto;

  const nascimento = parsearDataDoPacto(registro.dataNascimento);
  const nascimentoBom = nascimento !== null && nascimentoEhPlausivel(nascimento, agora);

  // CPF: grava/atualiza quando o CSV traz um valido E o banco nao tem o
  // MESMO ja gravado. Cobre quem CASOU POR NOME sem CPF no cadastro (o caso
  // que a F48/F49 nunca preenchiam) -- sem isso a base ficava sem documento
  // para sempre, mesmo trazendo o CPF certo em toda importacao seguinte.
  // Nao apaga CPF existente: `cpfBom` decide gravar, nunca `null`.
  const cpfDoArquivo = normalizarCpf(registro.cpf);
  const cpfBom = cpfDoArquivo !== '' && cpfEhValido(cpfDoArquivo);

  await db.student.update({
    where: { id: studentId },
    data: {
      profile: perfil,
      status: 'ACTIVE',
      // Ausente ou implausivel NAO apaga o que ja esta no banco.
      ...(nascimentoBom ? { birthDate: nascimento } : {}),
      // `cpf` e `cpfHash` andam JUNTOS -- ver a nota em `criarPessoa`.
      ...(cpfBom
        ? { cpf: cpfDoArquivo, cpfHash: calcularHashDeCpf(alvo.tenantId, cpfDoArquivo) }
        : {}),
    },
  });

  const cartao = await gravarCredencial(
    db,
    alvo.tenantId,
    studentId,
    'TURNSTILE_CARD',
    registro.cartao,
  );
  const facial = await gravarCredencial(
    db,
    alvo.tenantId,
    studentId,
    'FACIAL_ENROLL_ID',
    registro.identificadorFacial,
  );

  const telefone = await gravarContato(db, alvo.tenantId, studentId, 'PHONE', registro.telefone);
  const celular = await gravarContato(db, alvo.tenantId, studentId, 'WHATSAPP', registro.celular);
  const email = await gravarContato(db, alvo.tenantId, studentId, 'EMAIL', registro.email);

  /*
   * Endereco: LOGRADOURO basta, e o import ATUALIZA o que ja existe.
   *
   * As duas regras mudaram em 02/09/2026, por decisao do PI, e cada uma
   * escondia dado que o arquivo trazia:
   *
   *   - CEP DEIXOU DE SER OBRIGATORIO. Exigir logradouro E CEP descartava
   *     275 enderecos do export atual, que so tem 69 CEPs -- a recepcao
   *     ficava sem a rua de quase toda a base para preservar um CEP que o
   *     Pacto nunca preencheu. Rua sem CEP localiza; rua nenhuma nao.
   *
   *   - PASSA A ATUALIZAR. O `if (!jaTem)` nunca sobrescrevia, entao quem
   *     mudou de casa depois da primeira rodada ficava com o endereco
   *     antigo para sempre, e rerodar o import nao corrigia -- o contador
   *     ainda somava a pessoa como "endereco gravado", que era a leitura
   *     mais enganosa possivel.
   *
   * Campo VAZIO no arquivo continua nao apagando o que esta no banco (regra
   * do topo): `??` so troca o que veio preenchido.
   */
  const street = registro.endereco.trim();
  const postalCode = registro.cep.trim();
  let endereco = false;

  if (street !== '') {
    const municipio = registro.municipio.trim();
    const jaTem = await db.studentAddress.findFirst({ where: { studentId }, select: { id: true } });

    const dados = {
      street,
      district: registro.bairro.trim() || null,
      city: municipio === '' ? MUNICIPIO_PADRAO : municipio,
      state: normalizarUf(registro.uf) ?? UF_PADRAO,
    };

    if (jaTem) {
      await db.studentAddress.update({
        where: { id: jaTem.id },
        // CEP vazio NAO apaga o que ja esta gravado -- e o unico campo aqui
        // que o arquivo costuma nao trazer, e o do banco pode ser melhor.
        data: { ...dados, ...(postalCode === '' ? {} : { postalCode }) },
      });
    } else {
      // `postalCode` e NOT NULL sem default no schema, entao "nao sabemos" so
      // pode ser string vazia -- nao ha NULL disponivel. E o primeiro caso do
      // banco com CEP vazio (antes desta mudanca a regra o tornava impossivel),
      // e e deliberado: a alternativa era continuar descartando a rua inteira.
      await db.studentAddress.create({
        data: { tenantId: alvo.tenantId, studentId, ...dados, postalCode },
      });
    }

    endereco = true;
  }

  const efeito: EfeitoDaPessoa = {
    nascimento: nascimentoBom,
    nascimentoImplausivel: nascimento !== null && !nascimentoBom,
    cartao: cartao === true,
    facial: facial === true,
    credencialDeOutroAluno: cartao === false || facial === false,
    telefone: telefone || celular,
    email,
    endereco,
    semPeriodoDePlano: false,
    direitoDePlanoCriado: false,
    direitoDeVinculoCriado: false,
  };

  const source = origemDoDireito(perfil);

  if (perfil === 'STUDENT') {
    // QUEM ESTA IMPORTACAO CRIOU (nao existia no ArenaHub) comeca a contar
    // de HOJE da migracao, nao da `Data Inicio` historica do Pacto --
    // decisao do PI, 04/09/2026 (ver `INICIO_PARA_CRIADOS`). So "criado"
    // ativa a data forcada -- alguem que JA EXISTIA no ArenaHub (mesmo sem
    // assinatura, ex.: um `CANCELLED` reativando com plano) nao e "novo" no
    // sentido do pedido, e mantem a data do arquivo.
    const fimParaCriados = new Date(INICIO_PARA_CRIADOS);

    fimParaCriados.setUTCMonth(fimParaCriados.getUTCMonth() + MESES_DE_VINCULO);

    const inicio = criadoNestaExecucao ? INICIO_PARA_CRIADOS : parsearDataDoPacto(registro.dataInicio);
    const fim = criadoNestaExecucao ? fimParaCriados : parsearDataDoPacto(registro.dataFim);

    if (inicio === null || fim === null) {
      // ATIVAR CADASTRO NAO E DAR ACESSO (regra de arquitetura no 1). Sem
      // periodo nao ha o que congelar no snapshot, entao nao ha direito -- o
      // cadastro fica ACTIVE e a catraca continua fechada ate alguem resolver
      // a pendencia.
      return { ...efeito, semPeriodoDePlano: true };
    }

    // Idempotencia por chave natural `(tenantId, studentId, planId,
    // startsAt)` -- comportamento original desde a F48, que cobre CASADO
    // (mesma pessoa, mesma data do CSV em toda execucao) e RENOVACAO (mesmo
    // plano, novo ciclo, `startsAt` diferente cria uma segunda assinatura).
    //
    // CRIADO E DIFERENTE: a primeira execucao grava `INICIO_PARA_CRIADOS`; a
    // segunda encontra a MESMA pessoa por CPF/nome (casamento) e calcula
    // `inicio` a partir do CSV -- OUTRO valor -- entao a busca por
    // `startsAt` exato erra e recriaria a assinatura. `MARCADOR_CRIADO` e o
    // texto que reconhece essa assinatura em qualquer execucao seguinte,
    // sem precisar de um campo novo no schema so para isto.
    const porStartsAt = await db.subscription.findFirst({
      where: { tenantId: alvo.tenantId, studentId, planId: alvo.planId, startsAt: inicio },
      select: { id: true },
    });

    const porMarcadorDeCriacao = criadoNestaExecucao
      ? null
      : await db.subscription.findFirst({
          where: {
            tenantId: alvo.tenantId,
            studentId,
            planId: alvo.planId,
            lastReason: MARCADOR_CRIADO,
          },
          select: { id: true },
        });

    const assinatura = porStartsAt ?? porMarcadorDeCriacao;

    const subscriptionId =
      assinatura?.id ??
      (
        await db.subscription.create({
          data: {
            tenantId: alvo.tenantId,
            studentId,
            planId: alvo.planId,
            status: 'ACTIVE',
            startsAt: inicio,
            endsAt: fim,
            // SEM Invoice: vincular plano nao e cobrar. Essas pessoas ja
            // pagaram no sistema antigo.
            lastReason: criadoNestaExecucao
              ? MARCADOR_CRIADO
              : 'Importacao da base ativa do Pacto (F48)',
          },
          select: { id: true },
        })
      ).id;

    // Mesmo raciocinio da assinatura: o direito de quem foi CRIADO precisa
    // ser reconhecido pelo marcador tambem, senao a segunda execucao
    // calcula `startsAt` do CSV e cria um SEGUNDO direito para a mesma
    // pessoa.
    const direitoPorStartsAt = await db.entitlement.findFirst({
      where: { tenantId: alvo.tenantId, studentId, source, startsAt: inicio },
      select: { id: true },
    });

    const direitoPorMarcadorDeCriacao = criadoNestaExecucao
      ? null
      : await db.entitlement.findFirst({
          where: { tenantId: alvo.tenantId, studentId, source, reason: MARCADOR_CRIADO },
          select: { id: true },
        });

    if (direitoPorStartsAt ?? direitoPorMarcadorDeCriacao) return efeito;

    await criarDireito(db, {
      tenantId: alvo.tenantId,
      studentId,
      source,
      subscriptionId,
      startsAt: inicio,
      endsAt: fim,
      reason: criadoNestaExecucao ? MARCADOR_CRIADO : 'Importacao da base ativa do Pacto (F48)',
      snapshot: montarSnapshot({ id: alvo.planId, name: alvo.planName }, perfil, alvo.gymUnitIds),
    });

    return { ...efeito, direitoDePlanoCriado: true };
  }

  // Vinculo (ADMIN, STAFF, TRAINER): periodo nao vem do arquivo.
  // Idempotencia por `(tenantId, studentId, source)` -- uma pessoa tem um
  // direito por vinculo, nao um por execucao do seed.
  const jaTemVinculo = await db.entitlement.findFirst({
    where: { tenantId: alvo.tenantId, studentId, source },
    select: { id: true },
  });

  if (jaTemVinculo) return efeito;

  const fimDoVinculo = new Date(agora);

  fimDoVinculo.setUTCMonth(fimDoVinculo.getUTCMonth() + MESES_DE_VINCULO);

  await criarDireito(db, {
    tenantId: alvo.tenantId,
    studentId,
    source,
    subscriptionId: null,
    startsAt: agora,
    endsAt: fimDoVinculo,
    reason: `Vinculo (perfil ${perfil}) -- importacao da base ativa do Pacto (F48)`,
    snapshot: montarSnapshot(null, perfil, alvo.gymUnitIds),
  });

  return { ...efeito, direitoDeVinculoCriado: true };
}

/**
 * Ativa as pessoas que treinam hoje.
 *
 * `agora` entra por parametro (`CLAUDE.md`): o fim do direito por vinculo
 * sai dele, e ler o relogio aqui dentro tornaria o teste de fronteira
 * impossivel de escrever sem congelar o tempo global.
 *
 * ABRE UMA TRANSACAO POR PESSOA, e isso e deliberado. Cada gravacao e
 * idempotente por conta propria, mas idempotencia so conserta o estado se
 * houver uma proxima execucao: morrer no meio de uma pessoa deixaria
 * `status: ACTIVE` + credencial gravada e NENHUM direito -- cadastro ativo
 * com a porta fechada, que nao vira pendencia, nao entra em contador nenhum,
 * e so aparece quando a pessoa e barrada na catraca. Sao ~340 transacoes
 * curtas, nao uma gigante. Nao remova a transacao "porque a escrita ja e
 * idempotente": as duas garantias respondem a perguntas diferentes.
 *
 * Um erro numa pessoa nao mata a importacao: a linha vira pendencia
 * `erro ao gravar` e o laco segue, para nao perder as pendencias e os
 * contadores de quem ja passou.
 */
export async function importarPessoasAtivas(
  db: PrismaClientArenaHub,
  alvo: AlvoDaAtivacao,
  registros: readonly RegistroDePessoaAtiva[],
  agora: Date,
): Promise<ResultadoDaAtivacao> {
  const pendencias: Pendencia[] = [];
  const preenchimento: PreenchimentoPorCampo = {
    nascimento: 0,
    cartao: 0,
    facial: 0,
    telefone: 0,
    email: 0,
    endereco: 0,
  };

  let descartados = 0;
  let casados = 0;
  let criados = 0;
  let casadosPorCpf = 0;
  let casadosPorNome = 0;
  let direitosPorPlano = 0;
  let direitosPorVinculo = 0;

  // A lista de candidatos e lida UMA vez do banco e CRESCE durante o laco
  // (F49): quem e criado entra nela na hora. E isso -- e nao uma releitura
  // por linha -- que faz a segunda ocorrencia da mesma pessoa no arquivo
  // casar com a primeira em vez de criar um segundo cadastro.
  const alunos = await db.student.findMany({
    where: { tenantId: alvo.tenantId },
    select: { id: true, fullName: true, cpf: true, status: true, birthDate: true },
  });

  // Mutavel de proposito: `criarPessoa` empurra o cadastro novo aqui.
  const candidatos: CandidatoDeAluno[] = alunos.map((aluno) => ({
    id: aluno.id,
    nomeNormalizado: normalizarNome(aluno.fullName),
    cpfNormalizado: aluno.cpf === null ? null : normalizarCpf(aluno.cpf),
  }));

  // Situacao atual no ArenaHub, para nao reativar quem a recepcao bloqueou
  // de proposito. Vem da mesma leitura -- nao custa consulta extra.
  const situacaoAtual = new Map(alunos.map((aluno) => [aluno.id, aluno.status]));

  // Quem esta com o PLACEHOLDER de nascimento gravado, vindo da MESMA leitura
  // acima -- nao custa consulta extra.
  //
  // O aviso e sobre O ESTADO NO BANCO, e nao sobre o que esta execucao fez.
  // Emiti-lo so "quando cria" o fazia sumir exatamente na rodada em que a
  // data falsa continua la: na segunda passada a pessoa CASA em vez de
  // nascer. Se a recepcao rodasse o seed de novo antes de corrigir as 3
  // pessoas, o bloco de aviso sumia da tela e o `1900-01-01` ficava no banco
  // sem rastro visivel -- nada no `admin-web` sabe ler essa data como "nao
  // sabemos".
  //
  // O mapa e mutavel porque quem nasce agora entra nele na hora, e porque
  // quem tem a data corrigida sai: o aviso para de aparecer quando o
  // problema acaba, que e o que o mantem digno de ser lido.
  const comNascimentoPlaceholder = new Set(
    alunos.filter((aluno) => ehNascimentoPlaceholder(aluno.birthDate)).map((aluno) => aluno.id),
  );

  // Quem NASCEU nesta execucao. Casar com alguem deste conjunto significa
  // que DUAS LINHAS DO ARQUIVO sao a mesma pessoa -- o caso da linha 174 e
  // da 28 do arquivo real, com CPF e celular invertidos entre elas. A
  // primeira cria; a segunda vira pendencia em vez de sobrescrever calada os
  // dados da primeira com os da segunda.
  //
  // NAO CONFUNDIR COM IDEMPOTENCIA: na SEGUNDA EXECUCAO o conjunto comeca
  // vazio e a pessoa ja veio do banco, entao ela casa normalmente e e
  // reprocessada -- que e o comportamento certo.
  const criadosNestaExecucao = new Set<string>();

  for (const registro of registros) {
    if (ehRegistroDeTeste(registro.nome)) {
      descartados += 1;
      continue;
    }

    const perfil = traduzirPerfil(registro.codigoPerfil);

    if (perfil === null) {
      pendencias.push({ nome: registro.nome, motivo: 'perfil desconhecido' });
      continue;
    }

    const casamento = decidirCasamento({ nome: registro.nome, cpf: registro.cpf }, candidatos);

    if (casamento.tipo === 'AMBIGUO') {
      pendencias.push({ nome: registro.nome, motivo: 'mais de um candidato no cadastro' });
      continue;
    }

    // --- duas linhas do arquivo para a mesma pessoa (F49) ------------------
    //
    // Ja casa: a primeira ocorrencia criou o cadastro e o poz na lista de
    // candidatos. Reprocessar aqui gravaria por cima os dados da segunda
    // linha -- e no arquivo real as duas divergem (CPF e celular trocados),
    // entao "o ultimo vence" seria escolher em silencio qual versao da
    // pessoa e a verdadeira. Vira pendencia: a recepcao decide.
    if (casamento.tipo !== 'NAO_ENCONTRADO' && criadosNestaExecucao.has(casamento.studentId)) {
      pendencias.push({ nome: registro.nome, motivo: 'duplicata dentro do arquivo' });
      continue;
    }

    // --- a recepcao vence o arquivo antigo (I3) ----------------------------
    //
    // `BLOCKED` e `ARCHIVED` sao decisao DELIBERADA de quem esta no balcao,
    // tomada depois da exportacao do Pacto. Reativar em silencio devolveria
    // a catraca a quem alguem bloqueou de proposito -- e ninguem veria.
    // Vira pendencia: a recepcao decide, nao o arquivo.
    //
    // Nao se aplica a quem sera criado agora: cadastro que nao existe nao
    // tem decisao de balcao para respeitar.
    if (casamento.tipo !== 'NAO_ENCONTRADO') {
      const situacao = situacaoAtual.get(casamento.studentId);

      if (situacao === 'BLOCKED' || situacao === 'ARCHIVED') {
        pendencias.push({
          nome: registro.nome,
          motivo:
            situacao === 'BLOCKED'
              ? 'bloqueado no ArenaHub, veio como ativo no arquivo'
              : 'arquivado no ArenaHub, veio como ativo no arquivo',
        });
        continue;
      }
    }

    if (casamento.tipo === 'CPF') {
      casados += 1;
      casadosPorCpf += 1;
    } else if (casamento.tipo === 'NOME') {
      casados += 1;
      casadosPorNome += 1;
    }

    // `null` = ninguem no cadastro, entao a transacao abaixo cria. O narrow
    // acontece AQUI, fora da closure, para nao precisar de cast la dentro.
    const existente = casamento.tipo === 'NAO_ENCONTRADO' ? null : casamento.studentId;

    try {
      // UMA TRANSACAO POR PESSOA (I1). Cada gravacao e idempotente, mas isso
      // so conserta o estado se houver proxima execucao: morrer no meio de
      // uma pessoa deixaria `status: ACTIVE` + credencial gravada e NENHUM
      // direito -- cadastro ativo com porta fechada, que nao vira pendencia,
      // nao entra em contador nenhum, e so aparece quando a pessoa e barrada.
      // Sao ~340 transacoes curtas, nao uma gigante.
      //
      // A CRIACAO (F49) ENTRA NA MESMA TRANSACAO. Cadastrar fora dela
      // deixaria, num erro de credencial ou de direito, uma pessoa nova
      // `LEAD` sem nada -- que na proxima execucao casaria por nome e
      // seguiria adiante escondendo a falha original.
      const resultadoDaPessoa = await db.$transaction(async (tx) => {
        // `criada` e `existente` sao mutuamente exclusivos por construcao:
        // so se cria quando nao ha existente. O `if` (em vez de `??`)
        // mantem isso visivel para o compilador, sem fallback inventado
        // para um caso que nao ocorre.
        if (existente !== null) {
          return {
            criada: null,
            studentId: existente,
            efeito: await gravarPessoa(tx, alvo, registro, {
              studentId: existente,
              perfil,
              agora,
              criadoNestaExecucao: false,
            }),
          };
        }

        const criada = await criarPessoa(tx, alvo, registro, { agora });

        return {
          criada,
          studentId: criada.studentId,
          efeito: await gravarPessoa(tx, alvo, registro, {
            studentId: criada.studentId,
            perfil,
            agora,
            criadoNestaExecucao: true,
          }),
        };
      });

      const { criada, studentId, efeito } = resultadoDaPessoa;

      if (criada !== null) {
        criados += 1;
        criadosNestaExecucao.add(studentId);
        // Entra na lista de candidatos DEPOIS do commit: uma linha seguinte
        // do arquivo com o mesmo CPF ou o mesmo nome casa com esta, em vez
        // de criar um segundo cadastro.
        candidatos.push({
          id: studentId,
          nomeNormalizado: normalizarNome(registro.nome),
          cpfNormalizado: (() => {
            const cpf = normalizarCpf(registro.cpf);

            return cpf !== '' && cpfEhValido(cpf) ? cpf : null;
          })(),
        });

        if (criada.nascimentoPlaceholder) comNascimentoPlaceholder.add(studentId);
      }

      // `gravarPessoa` acabou de gravar uma data BOA vinda do arquivo: o
      // placeholder deixou de existir nesta linha, entao o aviso nao se
      // aplica mais. E o caso de quem foi cadastrado sem data numa rodada e
      // ganhou a data numa exportacao posterior do Pacto -- avisar ali seria
      // mandar a recepcao corrigir o que o proprio seed ja corrigiu.
      if (efeito.nascimento) comNascimentoPlaceholder.delete(studentId);

      // NAO PODE ACONTECER CALADO, EM NENHUMA EXECUCAO: existe no banco uma
      // pessoa com data que ninguem escolheu, e a pendencia e o unico jeito
      // de a recepcao saber quais linhas precisam da data de verdade.
      //
      // Le o ESTADO (o `birthDate` gravado), nao o evento (`criada`): quem
      // ja existia com o placeholder tambem entra, e quem teve a data
      // corrigida sai sozinho na proxima rodada.
      if (comNascimentoPlaceholder.has(studentId)) {
        pendencias.push({ nome: registro.nome, motivo: 'cadastrado sem data de nascimento' });
      }

      // Quem esta com o placeholder ja virou `cadastrado sem data de
      // nascimento` acima -- e a mesma causa (nao ha data boa). Duas
      // pendencias para uma linha fariam a recepcao procurar dois problemas
      // onde ha um.
      if (efeito.nascimentoImplausivel && !comNascimentoPlaceholder.has(studentId)) {
        pendencias.push({ nome: registro.nome, motivo: 'nascimento implausivel' });
      }

      if (efeito.credencialDeOutroAluno) {
        pendencias.push({ nome: registro.nome, motivo: 'credencial ja pertence a outro aluno' });
      }

      if (efeito.semPeriodoDePlano) {
        pendencias.push({ nome: registro.nome, motivo: 'aluno sem periodo de plano' });
      }

      if (efeito.nascimento) preenchimento.nascimento += 1;
      if (efeito.cartao) preenchimento.cartao += 1;
      if (efeito.facial) preenchimento.facial += 1;
      if (efeito.telefone) preenchimento.telefone += 1;
      if (efeito.email) preenchimento.email += 1;
      if (efeito.endereco) preenchimento.endereco += 1;

      // CONTAM DIREITO CRIADO, nao pessoa que passou pelo ramo (C2). Na
      // segunda execucao vem zero, que e a verdade -- e a leitura contraria
      // ("331 direitos por plano" quando nenhum foi criado) e exatamente o
      // que esconderia um defeito de concessao de acesso.
      if (efeito.direitoDePlanoCriado) direitosPorPlano += 1;
      if (efeito.direitoDeVinculoCriado) direitosPorVinculo += 1;
    } catch (erro: unknown) {
      // UM ERRO NUMA PESSOA NAO PODE MATAR A IMPORTACAO (I2). Sem isto, uma
      // falha de banco na linha 200 perde as pendencias e os contadores das
      // 199 anteriores -- e ninguem fica sabendo quantas pessoas ja entraram.
      // A transacao acima ja desfez a pessoa que falhou.
      pendencias.push({
        nome: registro.nome,
        motivo: 'erro ao gravar',
        detalhe: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return {
    lidos: registros.length,
    descartados,
    casados,
    criados,
    casadosPorCpf,
    casadosPorNome,
    direitosPorPlano,
    direitosPorVinculo,
    preenchimento,
    pendencias,
  };
}
