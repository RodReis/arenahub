import { Ausente } from './Ausente.js';

type Format = 'date' | 'datetime' | 'time';

const OPCOES: Record<Format, Intl.DateTimeFormatOptions> = {
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
  datetime: {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  time: { hour: '2-digit', minute: '2-digit' },
};

interface Props {
  readonly iso: string | null;
  /**
   * Timezone da UNIDADE, obrigatorio e sem valor padrao.
   *
   * Um default `'America/Sao_Paulo'` reproduziria com outro nome o bug que
   * este componente existe para matar: as quatro implementacoes que ele
   * substitui hardcodavam exatamente essa string. `units/page.tsx` ja
   * renderiza uma coluna "Fuso horario" por unidade -- o painel JA SABE que
   * fusos diferem, e hoje ignora.
   *
   * Sem default, quem chama e obrigado a dizer de onde tirou o fuso, no ponto
   * onde a suposicao fica visivel.
   */
  readonly timeZone: string;
  readonly format?: Format;
}

/**
 * Data e hora no fuso da unidade -- DS-PAINEL.md §9, regra 5 de lint.
 *
 * `toLocaleString()` sem `timeZone` usa o relogio de quem olha: a recepcao de
 * Curitiba conferindo acesso da unidade de Manaus veria o horario errado, e a
 * janela de acesso passaria a depender de onde a pessoa esta.
 */
/**
 * `YYYY-MM-DD` puro, sem `T` -- data que NAO tem hora nem fuso.
 *
 * Nascimento, competencia de fatura, dia de aula. A API as devolve assim de
 * proposito (`birthDate: aluno.birthDate.toISOString().slice(0, 10)`), e o
 * schema Prisma as declara `@db.Date` com o aviso escrito ao lado: *"data de
 * nascimento nao tem hora nem fuso. Gravar como timestamp faria 01/01 virar
 * 31/12 na conversao de timezone"*.
 *
 * Nao e heuristica: instante SEMPRE vem de `.toISOString()` e sempre carrega
 * `T...Z`. O formato do dado ja distingue os dois casos.
 */
const DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;

export function TenantDateTime({ iso, timeZone, format = 'datetime' }: Props) {
  if (!iso) return <Ausente />;

  /*
   * DATA PURA NAO CONVERTE FUSO -- e a correcao do bug que o PI viu em
   * 24/08/2026: nascimento gravado como 16/07 aparecia 15/07 na ficha e
   * 16/07 no formulario de edicao, porque a ficha reinterpretava a data
   * como meia-noite UTC e a puxava tres horas para tras.
   *
   * A guarda vive AQUI, e nao numa prop nova nos call sites, porque prop
   * exige que cada chamada lembre de passa-la -- e a proxima tela que
   * renderizar nascimento esqueceria, trazendo o defeito de volta pela
   * porta que esta linha fecha.
   */
  const ehDataPura = DATA_PURA.test(iso);
  const data = new Date(ehDataPura ? `${iso}T00:00:00.000Z` : iso);

  // Guarda preservada das quatro implementacoes substituidas: sem ela, uma
  // string invalida renderiza "Invalid Date" na tela da recepcao.
  if (!Number.isFinite(data.getTime())) return <Ausente />;

  const texto = new Intl.DateTimeFormat('pt-BR', {
    ...OPCOES[format],
    timeZone: ehDataPura ? 'UTC' : timeZone,
  }).format(data);

  return <time dateTime={iso}>{texto}</time>;
}
