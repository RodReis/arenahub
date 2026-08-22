import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';
import { converterParaCanonica, TIPOS_DE_MEDIDA, type TipoDeMedida } from './medida.js';
import { valoresAceitos, type CampoExtraido } from './revisao-de-importacao.js';
import type { ArquivoDaSessao, TipoDeLaudo } from './sessao-de-revisao.js';

/**
 * Consolidação dos laudos da MESMA medição (spec §3.3).
 *
 * Funções puras: sem banco, sem relógio, sem rede.
 *
 * ---------------------------------------------------------------------------
 * A ASSIMETRIA É DELIBERADA: ERRAR PARA O LADO DE MOSTRAR.
 * ---------------------------------------------------------------------------
 *
 * Fundir dois valores que divergem ESCONDE do professor que a balança
 * exportou errado — e o número errado vira histórico com selo de confirmado
 * por dois arquivos. Mostrar divergência que era só arredondamento custa um
 * clique. Por isso a tolerância é apertada: o erro barato é o preferido.
 */

/**
 * Quanto dois valores podem diferir e ainda serem "o mesmo".
 *
 * Deriva da PRECISÃO IMPRESSA no laudo, não de palpite: a balança escreve
 * peso com 2 casas (92,25) e o app com 1 (92,3), então meio décimo cobre o
 * arredondamento e nada mais. Percentual é impresso com 1 casa, mas a escala
 * de gordura corporal é mais sensível a erro de digitação — tolerância
 * menor que a de massa.
 */
export function toleranciaDe(tipo: TipoDeMedida): number {
  if (tipo === 'HEART_RATE') return 0; // bpm é inteiro: 89 e 99 são valores distintos.
  if (tipo === 'WAIST_HIP_RATIO') return 0.005;
  if (tipo.endsWith('_PERCENT')) return 0.03;
  return 0.05;
}

/** Dois campos medem a mesma coisa com o mesmo valor? */
export function equivalentes(a: CampoExtraido, b: CampoExtraido): boolean {
  if (a.type !== b.type) return false;

  // INV-104: ausência não é zero, e ausência não equivale a nada — nem a
  // outra ausência: dois arquivos que não leram o campo não confirmam um
  // ao outro.
  if (a.extractedValue === null || b.extractedValue === null) return false;

  try {
    const canonicaA = converterParaCanonica({
      type: a.type, value: a.extractedValue, unit: a.extractedUnit,
    });
    const canonicaB = converterParaCanonica({
      type: b.type, value: b.extractedValue, unit: b.extractedUnit,
    });

    return Math.abs(canonicaA.canonicalValue - canonicaB.canonicalValue) <= toleranciaDe(a.type);
  } catch (erro) {
    // Bug de programação (ex.: TypeError) não é divergência -- tem que
    // estourar, não virar um "false" plausível que esconde o bug num
    // resultado de revisão normal.
    if (!(erro instanceof ErroDeDominio)) throw erro;

    // Valor fora da faixa plausível ou unidade incompatível NÃO é "não sei" —
    // é exatamente a divergência que o humano precisa ver. Nunca propagar o
    // throw: um campo implausível derrubaria a tela de revisão inteira.
    return false;
  }
}

export interface LinhaConsolidada {
  readonly type: TipoDeMedida;
  /** Um campo quando concordam; todos quando divergem. */
  readonly campos: readonly CampoExtraido[];
  readonly concordante: boolean;
  readonly origens: readonly string[];
}

/**
 * Agrupa por tipo e decide, por grupo, se é uma linha ou várias.
 *
 * Ordem de entrada preservada: a origem que aparece primeiro é a primeira
 * listada, e a revisão fica estável entre recarregamentos.
 */
export function consolidar(campos: readonly CampoExtraido[]): LinhaConsolidada[] {
  const porTipo = new Map<TipoDeMedida, CampoExtraido[]>();

  for (const campo of campos) {
    const grupo = porTipo.get(campo.type);
    if (grupo === undefined) porTipo.set(campo.type, [campo]);
    else grupo.push(campo);
  }

  const linhas: LinhaConsolidada[] = [];

  for (const [type, grupo] of porTipo) {
    // grupo nunca e vazio: cada entrada do Map nasce com [campo] (linha 80).
    const primeiro = grupo[0]!;
    const todosConcordam = grupo.every((campo) => equivalentes(primeiro, campo));
    const origens = grupo
      .map((campo) => campo.sourceLabel)
      .filter((label): label is string => label !== null);

    linhas.push({
      type,
      campos: todosConcordam ? [primeiro] : grupo,
      concordante: todosConcordam && grupo.length > 1,
      origens,
    });
  }

  // ORDEM CANONICA, e nao a ordem em que os campos sairam do banco.
  //
  // `TIPOS_DE_MEDIDA` comeca por peso e altura e segue a leitura do laudo;
  // e a ordem que quem confere espera. Sem isto a tela seguia a ordem
  // FISICA das linhas do Postgres, que muda quando uma tupla e reescrita:
  // observado ao vivo, "Peso" apareceu na 1a linha num carregamento e na
  // 10a no seguinte, sem nada ter mudado no dado.
  //
  // Tipo fora da lista (nunca deveria existir -- `TipoDeMedida` e fechado)
  // vai para o fim em vez de sumir ou quebrar a ordenacao.
  const posicao = (tipo: TipoDeMedida): number => {
    const indice = TIPOS_DE_MEDIDA.indexOf(tipo);

    return indice === -1 ? TIPOS_DE_MEDIDA.length : indice;
  };

  linhas.sort((a, b) => posicao(a.type) - posicao(b.type));

  return linhas;
}

/**
 * Qual TIPO DE LAUDO vence quando dois aparelhos medem o MESMO tipo de
 * medida e discordam (ADR-041, decisao 1).
 *
 * Com a publicacao automatica ninguem esta ali para escolher, entao a
 * escolha tem de ser deterministica e explicavel -- e ela e por tipo de
 * laudo, NUNCA por nome de arquivo: o rotulo e escolhido por quem anexa, e
 * um arquivo chamado `ecg-agosto.pdf` pode perfeitamente ser a exportacao
 * da balanca.
 *
 *   - `HEART_RATE` -> vence o **ECG**. A balanca reporta repouso; o ECG
 *     mede o coracao por trinta segundos. E o aparelho feito para isso.
 *   - todo o resto -> vence a **balanca** (`BIOIMPEDANCE`). Ela MEDIU o
 *     corpo; o app (`BIOIMPEDANCE_ANALYSIS`) DERIVOU numeros a partir da
 *     medicao dela. Entre o medido e o calculado em cima, publica-se o
 *     medido.
 *
 * A distincao balanca/app so existe porque o tipo e DECLARADO no envio: o
 * OCR de imagem devolve `BIOIMPEDANCE` para toda foto, e com os dois
 * arquivos chegando como o mesmo tipo esta funcao nao tinha em que se
 * apoiar -- travou a primeira medicao real com `mais de um valor aceito
 * para o tipo BODY_FAT_MASS`.
 *
 * O valor perdedor NAO some: continua gravado como campo extraido, que e a
 * proveniencia. So nao vira a medida da avaliacao.
 */
export function laudoQueVence(tipo: TipoDeMedida): TipoDeLaudo {
  return tipo === 'HEART_RATE' ? 'ECG' : 'BIOIMPEDANCE';
}

/**
 * Resolve a linha divergente pela origem.
 *
 * `null` quando o conflito e REAL e nao ha regra que o resolva -- dois
 * laudos do MESMO tipo discordando (duas bioimpedancias com pesos
 * diferentes) e sinal de problema no aparelho, e escolher um lado
 * esconderia o defeito em vez de mostra-lo. Nesse caso o erro sobe
 * (`MedidaDuplicadaNaSessaoError`) em vez de a funcao inventar um vencedor.
 */
export function desempatarPorOrigem(
  linha: LinhaConsolidada,
  arquivos: readonly ArquivoDaSessao[],
): CampoExtraido | null {
  const tipoVencedor = laudoQueVence(linha.type);

  // Arquivos DAQUELE tipo nesta sessao. Duas balancas na mesma sessao nao
  // produzem vencedor: o criterio nao distingue entre elas, e escolher a
  // primeira seria decidir por ordem de upload -- que nao e evidencia de
  // nada.
  const ids = arquivos
    .filter((arquivo) => arquivo.tipoDeLaudo === tipoVencedor)
    .map((arquivo) => arquivo.importId);

  if (ids.length !== 1) return null;

  // Casa por `importId` e NUNCA por `sourceLabel`: o rotulo do CAMPO vem do
  // nome do arquivo enviado e o do ARQUIVO vem do conteudo extraido, entao
  // comparar os dois textos falha justamente no caso real -- tres fotos de
  // WhatsApp, com rotulo de campo `WhatsApp Image 2026-08-04 at 08.21.31` e
  // rotulo de arquivo `CF610_G`.
  const vencedores = linha.campos.filter((campo) => campo.importId === ids[0]);

  return vencedores.length === 1 ? (vencedores[0] ?? null) : null;
}

/**
 * O campo de uma linha que VIRA a medida da avaliacao.
 *
 * ---------------------------------------------------------------------------
 * FONTE UNICA -- e a razao de esta funcao existir (achado de revisao adversarial).
 * ---------------------------------------------------------------------------
 *
 * Duas camadas precisam da MESMA resposta: `valoresAceitosDaSessao` grava a
 * medida no banco, e o DTO da sessao diz a tela qual campo foi publicado. A
 * primeira versao respondeu a pergunta duas vezes, com predicados
 * diferentes: o servico contava campos ACEITOS (`valoresAceitos`, que filtra
 * por `state`) e o controller contava campos BRUTOS (`campos.length`).
 *
 * O caso que separava os dois era real, nao teorico: balanca le
 * `HEART_RATE: 65`, ECG nao consegue ler o mesmo campo
 * (`extractedValue: null`). A linha fica DIVERGENTE com dois campos, mas so
 * UM aceito depois que a publicacao automatica marca o nulo como
 * `DISCARDED`. Pelo predicado do servico nao havia desempate a fazer -- o
 * banco gravava 65, da balanca. Pelo predicado do controller havia, e o
 * desempate elegia o ECG (`laudoQueVence('HEART_RATE')`), cujo campo estava
 * DESCARTADO e vazio. A tela apontaria para um campo que o historico nao
 * guardou.
 *
 * Em dado de saude essa e a pior forma de erro possivel: a tela e o banco
 * discordando sem ninguem errar visivelmente.
 *
 * `null` quando nenhum campo foi aceito, ou quando ha mais de um aceito e o
 * desempate nao resolve -- dois laudos do mesmo tipo discordando e defeito
 * de aparelho, e ai o conflito SOBE em vez de ser decidido por chute.
 */
export function campoQueVirouMedida(
  linha: LinhaConsolidada,
  arquivos: readonly ArquivoDaSessao[],
): CampoExtraido | null {
  const aceitos = linha.campos.filter((campo) => valoresAceitos([campo]).length > 0);

  if (aceitos.length === 0) return null;
  if (aceitos.length === 1) return aceitos[0] ?? null;

  // Mais de um aceito -- so aqui existe divergencia REAL a desempatar, e o
  // desempate roda sobre os ACEITOS, nunca sobre a linha crua: um campo
  // descartado nao pode vencer nada.
  return desempatarPorOrigem({ ...linha, campos: aceitos }, arquivos);
}
