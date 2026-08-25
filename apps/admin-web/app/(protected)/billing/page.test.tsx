import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PainelFinanceiroPage, { periodosDisponiveis } from './page';

/**
 * Painel financeiro gerencial -- F54, `SPEC-054`.
 *
 * O que estes testes guardam nao e layout: e a regra que decide se a tela
 * INFORMA ou MENTE. Ausencia de dado aparecendo como zero, serie curta
 * desenhada como tendencia e base de calculo omitida sao os tres riscos que a
 * §5 da spec manda tratar -- e nenhum deles quebra typecheck, lint ou build.
 */

const RESUMO = {
  de: '2026-08-01T00:00:00.000Z',
  ate: '2026-09-01T00:00:00.000Z',
  recebidoMinor: 45_000,
  pagamentosConfirmados: 3,
  receitaEsperadaMinor: 60_000,
  aReceberMinor: 15_000,
  faturasAReceber: 1,
  vencidoMinor: 20_000,
  faturasVencidas: 2,
  faixas: [
    { rotulo: 'Até 15 dias', minorTotal: 10_000, quantidade: 1 },
    { rotulo: '16 a 30 dias', minorTotal: 10_000, quantidade: 1 },
    { rotulo: '31 a 60 dias', minorTotal: 0, quantidade: 0 },
    { rotulo: 'Mais de 60 dias', minorTotal: 0, quantidade: 0 },
  ],
  estornadoMinor: 0,
  ticketMedioMinor: 15_000,
  taxaDeInadimplencia: 33.3,
  quebraPorMetodo: [
    { metodo: 'MANUAL', minorTotal: 5_000, quantidade: 1 },
    { metodo: 'PIX', minorTotal: 40_000, quantidade: 2 },
    { metodo: 'CARD', minorTotal: 0, quantidade: 0 },
  ],
  serie: {
    pontos: [
      { competencia: '2026-06', faturadoMinor: 30_000, recebidoMinor: 30_000 },
      { competencia: '2026-07', faturadoMinor: 40_000, recebidoMinor: 20_000 },
      { competencia: '2026-08', faturadoMinor: 50_000, recebidoMinor: 45_000 },
    ],
    suficienteParaLinha: true,
  },
  competenciasDisponiveis: ['2026-06', '2026-07', '2026-08'],
  base: { alunosPagantes: 3, alunosInadimplentes: 1, assinaturasAtivas: 2 },
};

async function renderizar(
  resumo: unknown = RESUMO,
  busca: { de?: string; ate?: string } = {},
) {
  vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: resumo, cookiesDaApi: [] });

  const elemento = await PainelFinanceiroPage({ searchParams: Promise.resolve(busca) });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('painel financeiro', () => {
  it('mostra o recebido, o a receber e o vencido', async () => {
    await renderizar();

    expect(screen.getByTestId('recebido-no-periodo')).toHaveTextContent('450,00');
    expect(screen.getByTestId('a-receber')).toHaveTextContent('150,00');
    expect(screen.getByTestId('vencido')).toHaveTextContent('200,00');
  });

  /**
   * O ESTORNO PRECISA ESTAR VISIVEL quando existe: o recebido ja vem liquido
   * do backend, e sem a linha o dono descobriria a devolucao so no extrato.
   */
  it('mostra o estorno como indicador proprio, ja descontado do recebido', async () => {
    await renderizar({ ...RESUMO, recebidoMinor: 36_000, estornadoMinor: 9_000 });

    expect(screen.getByTestId('estornado')).toHaveTextContent('90,00');
    expect(screen.getByTestId('recebido-no-periodo')).toHaveTextContent('360,00');
    // A frase importa: sem ela o gestor somaria o estorno ao recebido.
    expect(screen.getByText(/já descontado do recebido/i)).toBeInTheDocument();
  });

  /** Sem devolucao, a linha nao existe -- "Estornado R$ 0,00" gastaria peso a toa. */
  it('nao mostra linha de estorno quando nao houve devolucao', async () => {
    await renderizar();

    expect(screen.queryByTestId('estornado')).not.toBeInTheDocument();
  });

  /**
   * A JANELA VEM DA URL, e o teste existe porque a primeira versao desta tela
   * NAO a lia: chamava a API sem parametro nenhum e ficava presa no mes
   * passado para sempre. O backend aceitava `de`/`ate` desde o inicio e nada
   * os fornecia -- lacuna invisivel para typecheck, lint e build, achada so
   * abrindo a tela.
   */
  it('repassa o periodo da URL para a API', async () => {
    await renderizar(RESUMO, { de: '2026-08-01T00:00:00.000Z', ate: '2026-08-25T00:00:00.000Z' });

    expect(chamarApi).toHaveBeenCalledWith(
      '/api/v1/billing/summary?de=2026-08-01T00%3A00%3A00.000Z&ate=2026-08-25T00%3A00%3A00.000Z',
    );
  });

  /** Sem parametro, quem decide a janela e o backend -- nao a tela. */
  it('nao inventa janela quando a URL nao traz periodo', async () => {
    await renderizar();

    expect(chamarApi).toHaveBeenCalledWith('/api/v1/billing/summary');
  });

  /**
   * A JANELA VAI VISIVEL, e nao e enfeite: o backend recusa periodo em curso
   * e aplica o ultimo mes fechado por default. Sem dizer qual periodo somou, o
   * gestor leria os numeros como "agora" -- e eles nao sao.
   */
  it('declara o periodo apurado', async () => {
    await renderizar();

    expect(screen.getByTestId('periodo-do-resumo')).toHaveTextContent('01/08/2026 a 01/09/2026');
  });

  /**
   * `—` E NAO `0%`. Academia sem assinatura nao tem 0% de inadimplencia: tem
   * uma taxa que nao existe. Zero seria uma meta batida em cima de nada.
   */
  it('mostra ausencia, nao zero, quando a taxa de inadimplencia nao existe', async () => {
    await renderizar({
      ...RESUMO,
      taxaDeInadimplencia: null,
      base: { alunosPagantes: 0, alunosInadimplentes: 0, assinaturasAtivas: 0 },
    });

    const taxa = screen.getByTestId('taxa-de-inadimplencia');
    expect(taxa).toHaveTextContent('—');
    expect(taxa).not.toHaveTextContent('0%');
  });

  /**
   * Mesmo criterio para o ticket: sem pagamento nao ha do que tirar media, e
   * "R$ 0,00" seria lido como "o aluno medio pagou nada".
   */
  it('mostra ausencia, nao zero, quando nao houve pagamento no periodo', async () => {
    await renderizar({
      ...RESUMO,
      recebidoMinor: 0,
      pagamentosConfirmados: 0,
      ticketMedioMinor: null,
    });

    const ticket = screen.getByTestId('ticket-medio');
    expect(ticket).toHaveTextContent('—');
    expect(ticket).not.toHaveTextContent('0,00');
  });

  /**
   * O RISCO DA §5.1, e o estado em que a base REAL nasce hoje: um mes de dado.
   *
   * A tabela CONTINUA aparecendo -- o dado existe e e consultavel. O que a
   * serie curta nao autoriza e a leitura de TENDENCIA, e por isso o aviso.
   */
  it('avisa que a serie e curta demais para comparar periodos', async () => {
    await renderizar({
      ...RESUMO,
      serie: {
        pontos: [{ competencia: '2026-08', faturadoMinor: 50_000, recebidoMinor: 45_000 }],
        suficienteParaLinha: false,
      },
    });

    expect(screen.getByTestId('serie-insuficiente')).toHaveTextContent(/pelo menos três/i);
    expect(screen.getByTestId('serie-por-competencia')).toBeInTheDocument();
  });

  it('nao avisa nada quando a serie tem pontos suficientes', async () => {
    await renderizar();

    expect(screen.queryByTestId('serie-insuficiente')).not.toBeInTheDocument();
  });

  /**
   * A COMPETENCIA E LIDA COMO MES DE REFERENCIA, nao como instante.
   *
   * `new Date('2026-08')` seguido de `getMonth()` no fuso do servidor
   * (America/Sao_Paulo, UTC-3) devolveria JULHO. E o mesmo bug de um dia que a
   * F53 ja produziu com `billingPeriod`.
   */
  it('nao desloca a competencia para o mes anterior', async () => {
    await renderizar();

    const tabela = screen.getByTestId('serie-por-competencia');
    expect(tabela).toHaveTextContent('ago/2026');
    expect(tabela).not.toHaveTextContent('jul/2026 50');
  });

  /**
   * A BASE DE CALCULO, declarada (§5.2): os ~340 alunos ativados e os 1.926
   * importados como `CANCELLED` distorcem qualquer percentual, e uma taxa lida
   * sem o denominador afirma sobre a ACADEMIA o que e verdade sobre a
   * IMPORTACAO.
   */
  it('declara a base sobre a qual calcula', async () => {
    await renderizar();

    const base = screen.getByTestId('base-de-calculo');
    expect(base).toHaveTextContent('3 aluno(s) com assinatura ativa ou em atraso');
    // Sem espaco entre `dt` e `dd`: os dois sao `display: inline` e o
    // `textContent` os concatena direto. O espaco visual vem do CSS.
    expect(base).toHaveTextContent('Com fatura vencida:1');
    expect(base).toHaveTextContent('Assinaturas ativas:2');
  });

  /**
   * A QUEBRA MOSTRA AS TRES FORMAS, mesmo zeradas -- e o que faz ela somar
   * 100%. Omitir a fatia sem movimento faria "PIX 40 / espécie 5" parecer o
   * total, escondendo que cartão existe e não entrou.
   */
  it('mostra as tres formas de pagamento, inclusive a que nao teve movimento', async () => {
    await renderizar();

    const tabela = screen.getByTestId('quebra-por-metodo');
    expect(tabela).toHaveTextContent('PIX');
    expect(tabela).toHaveTextContent('Cartão');
    expect(tabela).toHaveTextContent('Espécie');
  });

  /**
   * O PERCENTUAL E A RAZAO DA MUDANCA de tabela para barras: "o PIX e quanto
   * do meu caixa?" e a pergunta do bloco, e ela se responde por proporcao.
   *
   * PIX: 40.000 de 45.000 recebidos = 88,9%. Espécie: 5.000 = 11,1%.
   *
   * O CARTAO SEM MOVIMENTO MOSTRA `0%`, e aqui zero e verdade: ha total do
   * qual ser parte, e a fatia e mesmo nula. `—` seria pior -- afirmaria que a
   * proporcao nao existe quando ela existe e vale zero.
   */
  it('mostra a proporcao de cada forma sobre o total recebido', async () => {
    await renderizar();

    const quebra = screen.getByTestId('quebra-por-metodo');
    expect(quebra).toHaveTextContent('88,9%');
    expect(quebra).toHaveTextContent('11,1%');
    expect(quebra).toHaveTextContent('0%');
  });

  /**
   * SEPARADOR DE MILHAR -- o bug que a versao anterior tinha.
   *
   * O rotulo saia como `R$ 12000,00` porque a tela formatava com
   * `toFixed(2).replace('.', ',')` em vez do formatador do DS. Doze mil sem
   * separador se confunde com mil e duzentos de relance, num grafico que
   * existe justamente para comparar tamanhos.
   */
  it('formata o rotulo do grafico de dividas com separador de milhar', async () => {
    await renderizar({
      ...RESUMO,
      vencidoMinor: 1_200_000,
      faturasVencidas: 3,
      faixas: [
        { rotulo: 'Até 15 dias', minorTotal: 1_200_000, quantidade: 3 },
        { rotulo: '16 a 30 dias', minorTotal: 0, quantidade: 0 },
        { rotulo: '31 a 60 dias', minorTotal: 0, quantidade: 0 },
        { rotulo: 'Mais de 60 dias', minorTotal: 0, quantidade: 0 },
      ],
    });

    const grafico = screen.getByTestId('faixas-da-divida');
    expect(grafico).toHaveTextContent('R$ 12.000,00');
    expect(grafico).not.toHaveTextContent('R$ 12000,00');
  });

  /**
   * A SERIE VIRA GRAFICO, e a tabela CONTINUA -- o grafico responde tendencia,
   * a tabela responde valor. Quem vai conferir um numero precisa do numero.
   */
  it('mostra o grafico de competencia junto da tabela, nao no lugar dela', async () => {
    await renderizar();

    expect(screen.getByTestId('grafico-de-competencia')).toBeInTheDocument();
    expect(screen.getByTestId('serie-por-competencia')).toBeInTheDocument();
  });

  /**
   * A COLUNA QUE FALTAVA: o gestor vinha subtraindo faturado menos recebido a
   * cada linha para achar o buraco do mes -- que e a pergunta do bloco.
   */
  it('mostra quanto nao entrou em cada competencia', async () => {
    await renderizar();

    // jun: 30.000 faturado, 30.000 recebido -> 0. jul: 40.000 - 20.000 = 20.000.
    const tabela = screen.getByTestId('serie-por-competencia');
    expect(tabela).toHaveTextContent('Não entrou');
    expect(tabela).toHaveTextContent('R$ 200,00');
  });

  /**
   * O SPARKLINE SO EXISTE PARA O RECEBIDO -- decisao do PI. "A receber" e
   * "vencido" sao fotos do instante e nao tem historico no banco; fabricar a
   * curva exigiria snapshot mensal, que e fatia nova.
   */
  it('mostra a tendencia do recebido quando ha serie', async () => {
    await renderizar();

    expect(screen.getByTestId('tendencia-do-recebido')).toBeInTheDocument();
  });

  /** Um ponto nao e tendencia: um traco reto afirmaria estabilidade nao medida. */
  it('nao mostra tendencia com uma competencia so', async () => {
    await renderizar({
      ...RESUMO,
      serie: {
        pontos: [{ competencia: '2026-08', faturadoMinor: 50_000, recebidoMinor: 45_000 }],
        suficienteParaLinha: false,
      },
    });

    expect(screen.queryByTestId('tendencia-do-recebido')).not.toBeInTheDocument();
  });

  /**
   * Sem entrada no periodo nao ha proporcao a mostrar -- e dividir por zero
   * produziria `NaN%` na tela.
   */
  it('mostra estado vazio na quebra quando nao houve pagamento', async () => {
    await renderizar({
      ...RESUMO,
      recebidoMinor: 0,
      pagamentosConfirmados: 0,
      ticketMedioMinor: null,
      quebraPorMetodo: [
        { metodo: 'MANUAL', minorTotal: 0, quantidade: 0 },
        { metodo: 'PIX', minorTotal: 0, quantidade: 0 },
        { metodo: 'CARD', minorTotal: 0, quantidade: 0 },
      ],
    });

    expect(screen.getByTestId('sem-pagamento')).toBeInTheDocument();
    expect(screen.queryByTestId('quebra-por-metodo')).not.toBeInTheDocument();
  });

  it('mostra estado vazio quando nao ha divida em aberto', async () => {
    await renderizar({
      ...RESUMO,
      vencidoMinor: 0,
      faturasVencidas: 0,
      faixas: RESUMO.faixas.map((f) => ({ ...f, minorTotal: 0, quantidade: 0 })),
    });

    expect(screen.getByTestId('sem-divida')).toBeInTheDocument();
    expect(screen.queryByTestId('faixas-da-divida')).not.toBeInTheDocument();
  });

  /**
   * A tela recusada mostra o problema, nao uma pagina em branco nem numeros
   * zerados -- que seriam indistinguiveis de uma academia sem movimento.
   */
  /**
   * O FILTRO DE MES -- ate aqui o periodo so existia pela URL, e digitar ISO
   * 8601 na barra de endereco e o oposto do "sem tempo para procurar" que o
   * PRODUCT.md descreve.
   */
  it('oferece um chip por competencia apurada', async () => {
    await renderizar();

    expect(screen.getByTestId('periodo-jun/2026')).toBeInTheDocument();
    expect(screen.getByTestId('periodo-jul/2026')).toBeInTheDocument();
    expect(screen.getByTestId('periodo-ago/2026')).toBeInTheDocument();
  });

  /**
   * `aria-current` E NAO SO A COR: cor sozinha nunca e canal unico (PRD), e
   * quem usa leitor de tela precisa saber qual periodo esta aberto.
   */
  it('marca o periodo aberto com aria-current, nao so com cor', async () => {
    await renderizar({
      ...RESUMO,
      de: '2026-07-01T00:00:00.000Z',
      ate: '2026-08-01T00:00:00.000Z',
    });

    expect(screen.getByTestId('periodo-jul/2026')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('periodo-jun/2026')).not.toHaveAttribute('aria-current');
  });

  /**
   * O BUG QUE O PI VIU NA TELA: clicar em "mai" e ficar preso la.
   *
   * O filtro derivava de `serie.pontos`, que olha 12 meses PARA TRAS a partir
   * do fim da janela. Apurando a competencia mais ANTIGA, a serie devolvia so
   * ela -- restava um chip, sem caminho de volta.
   *
   * Aqui a serie tem um ponto so (como o backend devolve ao apurar junho) e o
   * filtro continua com os tres. Se alguem religar o filtro a serie, este
   * teste cai.
   */
  it('mantem todos os chips ao apurar a competencia mais antiga', async () => {
    await renderizar({
      ...RESUMO,
      de: '2026-06-01T00:00:00.000Z',
      ate: '2026-07-01T00:00:00.000Z',
      // A serie encolhe -- e correto, ela olha para tras.
      serie: {
        pontos: [{ competencia: '2026-06', faturadoMinor: 30_000, recebidoMinor: 30_000 }],
        suficienteParaLinha: false,
      },
      // O filtro NAO encolhe.
      competenciasDisponiveis: ['2026-06', '2026-07', '2026-08'],
    });

    expect(screen.getByTestId('periodo-jun/2026')).toHaveAttribute('aria-current', 'page');
    // O caminho de volta existe.
    expect(screen.getByTestId('periodo-jul/2026')).toBeInTheDocument();
    expect(screen.getByTestId('periodo-ago/2026')).toBeInTheDocument();
  });

  /** Cada chip e uma URL -- estado em memoria nao se compartilha. */
  it('aponta cada chip para a janela daquele mes', async () => {
    await renderizar();

    expect(screen.getByTestId('periodo-jun/2026').getAttribute('href')).toContain(
      '2026-06-01T00%3A00%3A00.000Z',
    );
  });

  /**
   * A TABELA FICA RECOLHIDA e a acessibilidade nao depende dela: o
   * `SerieFinanceira` publica tabela invisivel propria. O `<details>` fechado
   * economiza ~300px sem esconder o numero de quem vai conferir.
   */
  it('recolhe a tabela de valores atras de um detalhe fechado', async () => {
    const { container } = await renderizar();

    const detalhe = container.querySelector('details');
    expect(detalhe).not.toBeNull();
    expect(detalhe).not.toHaveAttribute('open');
    expect(screen.getByText('Ver valores exatos')).toBeInTheDocument();
  });

  it('mostra o erro quando a API recusa a consulta', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Proibido',
        status: 403,
        code: 'FORBIDDEN',
        correlationId: 'abc',
      },
      cookiesDaApi: [],
    });

    const elemento = await PainelFinanceiroPage({ searchParams: Promise.resolve({}) });
    render(<ToastProvider>{elemento}</ToastProvider>);

    expect(screen.getByTestId('erro-de-permissao')).toBeInTheDocument();
    expect(screen.queryByTestId('recebido-no-periodo')).not.toBeInTheDocument();
  });
});

/**
 * Os meses que o filtro oferece.
 *
 * DERIVADOS DA SERIE que o backend ja devolve, e nao de um calendario
 * inventado: oferecer um mes sem movimento levaria o gerente a uma tela vazia
 * que parece defeito.
 */
describe('periodosDisponiveis', () => {
  const JANELA = { de: '2026-07-01T00:00:00.000Z', ate: '2026-08-01T00:00:00.000Z' };

  it('ordena do mais antigo para o mais recente', () => {
    const periodos = periodosDisponiveis(['2026-08', '2026-06', '2026-07'], JANELA);

    expect(periodos.map((p) => p.rotulo)).toEqual(['jun/2026', 'jul/2026', 'ago/2026']);
  });

  it('monta a janela do mes, com fim exclusivo', () => {
    const [junho] = periodosDisponiveis(['2026-06'], JANELA);

    expect(junho?.de).toBe('2026-06-01T00:00:00.000Z');
    expect(junho?.ate).toBe('2026-07-01T00:00:00.000Z');
  });

  it('atravessa a virada de ano', () => {
    const [dezembro] = periodosDisponiveis(['2025-12'], JANELA);

    expect(dezembro?.ate).toBe('2026-01-01T00:00:00.000Z');
  });

  it('marca como atual o mes que bate com a janela aberta', () => {
    const periodos = periodosDisponiveis(['2026-06', '2026-07'], JANELA);

    expect(periodos.find((p) => p.rotulo === 'jul/2026')?.atual).toBe(true);
    expect(periodos.find((p) => p.rotulo === 'jun/2026')?.atual).toBe(false);
  });

  /**
   * MANTEM OS MAIS RECENTES quando ha mais que o limite: o backend devolve 12
   * meses, e doze chips seriam uma segunda barra de navegacao. Cortar os
   * antigos e o certo -- ninguem abre o painel para ver setembro do ano
   * passado primeiro.
   */
  it('corta os mais antigos ao passar do limite', () => {
    const doze = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
    const periodos = periodosDisponiveis(doze, JANELA, 6);

    expect(periodos).toHaveLength(6);
    expect(periodos[0]?.rotulo).toBe('jul/2026');
    expect(periodos[5]?.rotulo).toBe('dez/2026');
  });

  it('devolve lista vazia quando nao ha competencia', () => {
    expect(periodosDisponiveis([], JANELA)).toEqual([]);
  });
});
