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
export function TenantDateTime({ iso, timeZone, format = 'datetime' }: Props) {
  if (!iso) return <Ausente />;

  const data = new Date(iso);

  // Guarda preservada das quatro implementacoes substituidas: sem ela, uma
  // string invalida renderiza "Invalid Date" na tela da recepcao.
  if (!Number.isFinite(data.getTime())) return <Ausente />;

  const texto = new Intl.DateTimeFormat('pt-BR', { ...OPCOES[format], timeZone }).format(data);

  return <time dateTime={iso}>{texto}</time>;
}
