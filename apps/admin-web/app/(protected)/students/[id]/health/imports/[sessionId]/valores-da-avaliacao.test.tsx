import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AchadoDoEcg } from './achado-do-ecg';
import { CartoesDeArquivo } from './cartoes-de-arquivo';
import { ValoresDaAvaliacao, type LinhaDeRevisao } from './valores-da-avaliacao';
import { MetasEControle } from './metas-e-controle';
import {
  atributosDoAparelho,
  cartoesDeArquivo,
  recomendacoesDoAparelho,
  type ArquivoDaSessao,
  type SessaoDeRevisao,
} from './sessao';

/**
 * Testes da tela de avaliação publicada (ADR-041).
 *
 * `ValoresDaAvaliacao` é componente de SERVIDOR puro -- sem estado, sem
 * evento, sem Server Action. Por isso este arquivo não precisa mais de
 * `ToastProvider` nem de mock das actions: a tela deixou de agir e passou a
 * só mostrar.
 */

const linhaConcordante: LinhaDeRevisao = {
  type: 'WEIGHT',
  concordante: true,
  origens: ['Balança', 'App de análise'],
  campoPublicadoId: 'campo-1',
  campos: [
    {
      id: 'campo-1',
      type: 'WEIGHT',
      extractedValue: 82.4,
      extractedUnit: 'KG',
      confidence: 0.92,
      referenceMin: 60.6,
      referenceMax: 82,
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      leitura: 'ABOVE',
      importId: 'import-1',
    },
  ],
};

/**
 * Divergência RESOLVIDA pelo servidor: a balança venceu (ADR-041 decisão 1).
 * Os dois campos continuam vindo da API -- proveniência não se apaga -- mas
 * só o vencedor aparece na tela.
 */
const linhaDivergenteResolvida: LinhaDeRevisao = {
  type: 'BODY_FAT_PERCENT',
  concordante: false,
  origens: ['Balança', 'App de análise'],
  campoPublicadoId: 'campo-2a',
  campos: [
    {
      id: 'campo-2a',
      type: 'BODY_FAT_PERCENT',
      extractedValue: 18.2,
      extractedUnit: 'PERCENT',
      confidence: 0.7,
      referenceMin: 10,
      referenceMax: 20,
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      leitura: 'WITHIN',
      importId: 'import-1',
    },
    {
      id: 'campo-2b',
      type: 'BODY_FAT_PERCENT',
      extractedValue: 19.5,
      extractedUnit: 'PERCENT',
      confidence: 0.4,
      referenceMin: 10,
      referenceMax: 20,
      sourceLabel: 'App de análise',
      state: 'DISCARDED',
      leitura: 'WITHIN',
      importId: 'import-2',
    },
  ],
};

/** Divergência que o servidor NÃO resolveu -- dois laudos do mesmo tipo. */
const linhaEmConflito: LinhaDeRevisao = {
  ...linhaDivergenteResolvida,
  type: 'SKELETAL_MUSCLE_MASS',
  campoPublicadoId: null,
};

const linhaSemValor: LinhaDeRevisao = {
  type: 'VISCERAL_FAT_LEVEL',
  concordante: true,
  origens: ['Balança'],
  campoPublicadoId: 'campo-3',
  campos: [
    {
      id: 'campo-3',
      type: 'VISCERAL_FAT_LEVEL',
      extractedValue: null,
      extractedUnit: null,
      confidence: null,
      referenceMin: null,
      referenceMax: null,
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      leitura: 'UNKNOWN',
      importId: 'import-1',
    },
  ],
};

describe('valores da avaliação publicada', () => {
  it('mostra uma linha por medida, com valor, faixa e leitura', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante]} />);

    expect(screen.getAllByRole('row')).toHaveLength(2); // cabeçalho + 1
    expect(screen.getByText(/60,6/)).toBeInTheDocument();
    expect(screen.getByText(/acima da faixa/i)).toBeInTheDocument();
  });

  /**
   * O núcleo do ADR-041: a tela não pede escolha nenhuma. Nenhum rádio,
   * nenhum botão de confirmar, nenhum contador de pendências -- se algum
   * deles voltar, a publicação automática deixou de ser automática sem
   * ninguém perceber.
   */
  it('NÃO oferece escolha: sem rádio, sem botão, sem contador', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante, linhaDivergenteResolvida]} />);

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/exigem? confer[êe]ncia/i)).not.toBeInTheDocument();
  });

  /** Pedido explícito do PI: a coluna Origem saiu. */
  it('não mostra a coluna Origem', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante]} />);

    expect(screen.queryByRole('columnheader', { name: /origem/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/2 arquivos/i)).not.toBeInTheDocument();
  });

  it('não usa mais o título "Revisão campo a campo"', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante]} />);

    expect(screen.queryByText(/revis[ãa]o campo a campo/i)).not.toBeInTheDocument();
  });

  /**
   * Divergência resolvida mostra UMA linha -- a do vencedor -- e nunca a do
   * perdedor. Exibir os dois valores publicados sugeriria que a avaliação
   * gravou os dois, e ela gravou um.
   */
  it('divergência resolvida vira uma linha só, com o valor que venceu', () => {
    render(<ValoresDaAvaliacao linhas={[linhaDivergenteResolvida]} />);

    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText(/18,2/)).toBeInTheDocument();
    expect(screen.queryByText(/19,5/)).not.toBeInTheDocument();
  });

  /**
   * Campo em conflito continua FORA da tabela: exibir um dos lados sugeriria
   * que ele foi o publicado quando nada foi. O aviso em texto saiu (pedido do
   * PI), mas a linha nunca entrou -- e é isso que este teste protege.
   */
  it('campo em conflito não entra na tabela', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante, linhaEmConflito]} />);

    expect(screen.getAllByRole('row')).toHaveLength(2); // cabeçalho + a concordante
    expect(screen.queryByTestId(`linha-${linhaEmConflito.type}`)).not.toBeInTheDocument();
  });

  /**
   * MEDIDA SEM FAIXA VAI PARA A TABELA DE BAIXO.
   *
   * "Sem faixa publicada" repetido em dez linhas ocupava a coluna Leitura
   * inteira sem informar nada, e competia com os badges que importam. Quem
   * varre a tabela procura o que saiu da faixa.
   */
  it('separa em duas tabelas: com faixa e sem faixa', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante, linhaSemValor]} />);

    const comFaixa = screen.getByTestId('tabela-de-valores');
    const semFaixa = screen.getByTestId('tabela-sem-faixa');

    // `linhaConcordante` tem faixa (60,6–82); `linhaSemValor` não tem nenhuma.
    expect(comFaixa).toHaveTextContent(/peso/i);
    expect(semFaixa).toHaveTextContent(/gordura visceral/i);
    expect(semFaixa).not.toHaveTextContent(/sem faixa publicada/i);
    // A tabela de baixo não tem coluna de leitura -- ela não teria o que dizer.
    expect(semFaixa.querySelectorAll('thead th')).toHaveLength(2);
  });

  /** Tabela sem nenhuma linha não é renderizada -- cabeçalho vazio não informa. */
  it('não renderiza a tabela sem faixa quando todos os campos têm faixa', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante]} />);

    expect(screen.queryByTestId('tabela-sem-faixa')).not.toBeInTheDocument();
  });

  it('valor ausente é travessão, nunca zero (INV-104)', () => {
    render(<ValoresDaAvaliacao linhas={[linhaSemValor]} />);

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('o nome do campo é cabeçalho de linha, para o leitor de tela', () => {
    render(<ValoresDaAvaliacao linhas={[linhaConcordante]} />);

    expect(screen.getByRole('rowheader', { name: /peso/i })).toBeInTheDocument();
  });
});

describe('cartões de laudo com miniatura (ADR-041)', () => {
  const arquivos: ArquivoDaSessao[] = [
    { importId: 'import-1', sourceLabel: 'Balança', tipoDeLaudo: 'BIOIMPEDANCE', atributos: null },
    { importId: 'import-2', sourceLabel: 'ECG 30s', tipoDeLaudo: 'ECG', atributos: null },
  ];

  it('mostra a IMAGEM do laudo, não o nome do arquivo', () => {
    const cartoes = cartoesDeArquivo(
      arquivos,
      [linhaConcordante],
      new Map([['import-1', { url: 'https://storage/assinada', contentType: 'image/png' }]]),
    );

    render(<CartoesDeArquivo cartoes={cartoes} />);

    const imagem = screen.getByRole('img', { name: /bioimped[âa]ncia/i });
    expect(imagem).toHaveAttribute('src', 'https://storage/assinada');
    // O nome cru do arquivo não aparece em lugar nenhum do cartão.
    expect(screen.queryByText('Balança')).not.toBeInTheDocument();
  });

  it('PDF vira link para o original -- prévia falsa seria pior que nenhuma', () => {
    const cartoes = cartoesDeArquivo(
      arquivos,
      [linhaConcordante],
      new Map([['import-1', { url: 'https://storage/doc', contentType: 'application/pdf' }]]),
    );

    render(<CartoesDeArquivo cartoes={cartoes} />);

    expect(screen.getByTestId('previa-documento-import-1')).toHaveTextContent(/abrir pdf/i);
  });

  /**
   * Arquivo expurgado pela retenção curta (`MVP-03` §15) não é falha de
   * carregamento: a tela DIZ que o arquivo não existe mais, em vez de
   * mostrar ícone de imagem quebrada.
   */
  it('arquivo já expurgado explica a ausência, não quebra a imagem', () => {
    const cartoes = cartoesDeArquivo(arquivos, [linhaConcordante], new Map());

    render(<CartoesDeArquivo cartoes={cartoes} />);

    expect(screen.getByTestId('previa-ausente-import-1')).toHaveTextContent(/expurgado/i);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  /**
   * Regressão: a contagem casa por `importId`, nunca por `sourceLabel`. Com
   * o casamento por rótulo, o campo com `sourceLabel` "Balança" e o arquivo
   * com rótulo "CF610_G" nunca batiam, e todo cartão saía com zero campos.
   */
  it('conta os campos pelo importId, não pelo rótulo de origem', () => {
    const cartoes = cartoesDeArquivo(arquivos, [linhaConcordante]);

    expect(cartoes.find((c) => c.importId === 'import-1')?.totalDeCampos).toBe(1);
    expect(cartoes.find((c) => c.importId === 'import-2')?.totalDeCampos).toBe(0);
  });
});

describe('informacoes do ECG', () => {
  it('exibe TUDO que o aparelho reportou, sem acao nenhuma', () => {
    render(
      <AchadoDoEcg
        atributos={{
          ecgFinding: 'Ritmo nao classificado',
          ecgHeartRate: 92,
          ecgDurationSeconds: 30,
          ecgRecordedAt: 'segunda-feira, 3 de agosto de 2026 as 08:10:00',
          ecgTags: ['Atividade:Alta', 'Tontura'],
        }}
      />,
    );

    expect(screen.getByTestId('achado-ecg')).toHaveTextContent('Ritmo nao classificado');
    expect(screen.getByTestId('ecg-frequencia')).toHaveTextContent('92 bpm');
    expect(screen.getByTestId('ecg-duracao')).toHaveTextContent('30 s');
    expect(screen.getByTestId('ecg-tags')).toHaveTextContent('Atividade:Alta, Tontura');
    expect(screen.getByText(/não constituem diagnóstico/i)).toBeInTheDocument();

    // ADR-035: exibir e o limite. NENHUM botao, nenhuma conduta, nenhum
    // rotulo de gravidade derivado do texto -- interpretar enquadraria o
    // produto como dispositivo medico (RDC 657/2022).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/encaminhamento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exige leitura m[eé]dica/i)).not.toBeInTheDocument();
  });

  it('cada informacao ausente vira traco, nunca zero nem branco (INV-104)', () => {
    render(<AchadoDoEcg atributos={{ ecgFinding: 'Ritmo normal' }} />);

    expect(screen.getByTestId('achado-ecg')).toHaveTextContent('Ritmo normal');
    expect(screen.getByTestId('ecg-frequencia')).toHaveTextContent('—');
    expect(screen.getByTestId('ecg-duracao')).toHaveTextContent('—');
    expect(screen.getByTestId('ecg-tags')).toHaveTextContent('—');
  });

  it('sem arquivo de ECG na sessao, mostra ausencia em tudo', () => {
    render(<AchadoDoEcg />);

    expect(screen.getByTestId('achado-ecg')).toHaveTextContent('—');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * OBSERVAÇÕES é o campo que quem operou o aparelho digitou.
   *
   * Aparece VERBATIM e só quando existe: a maioria dos laudos vem sem, e uma
   * linha "Observações —" em todo ECG ocuparia espaço para dizer que ninguém
   * escreveu nada. As outras cinco são sempre esperadas, e por isso mostram
   * o traço.
   */
  it('mostra as observações do operador, verbatim', () => {
    render(<AchadoDoEcg atributos={{ ecgNotes: '9 okjgfs' }} />);

    expect(screen.getByTestId('ecg-observacoes')).toHaveTextContent('9 okjgfs');
  });

  it('laudo sem observações não renderiza a linha', () => {
    render(<AchadoDoEcg atributos={{ ecgFinding: 'Ritmo normal' }} />);

    expect(screen.queryByTestId('ecg-observacoes')).not.toBeInTheDocument();
  });
});

describe('atributosDoAparelho', () => {
  /**
   * Regressao: `sourceLabel` ("ECG 30s") e o achado ("Ritmo nao
   * classificado...") sao coisas DIFERENTES de proposito neste fixture. A
   * versao com bug lia `campo.sourceLabel` como se fosse o achado -- um
   * profissional veria o NOME DO APARELHO onde esperava o resultado.
   */
  it('le o achado do ECG do atributo do arquivo, nao do sourceLabel', () => {
    const sessao: SessaoDeRevisao = {
      sessionId: 'sessao-1',
      podeConfirmar: { pronta: true },
      linhas: [],
      arquivos: [
        {
          importId: 'import-bio',
          sourceLabel: 'CF610_G',
          tipoDeLaudo: 'BIOIMPEDANCE',
          atributos: null,
        },
        {
          importId: 'import-ecg',
          sourceLabel: 'ECG 30s',
          tipoDeLaudo: 'ECG',
          atributos: { ecgFinding: 'Ritmo nao classificado — fibrilacao atrial suspeita' },
        },
      ],
    };

    expect(atributosDoAparelho(sessao)).toEqual({
      ecgFinding: 'Ritmo nao classificado — fibrilacao atrial suspeita',
    });
  });

  it('nao ha achado quando nenhum arquivo trouxe atributo', () => {
    const sessao: SessaoDeRevisao = {
      sessionId: 'sessao-2',
      podeConfirmar: { pronta: true },
      linhas: [],
      arquivos: [
        {
          importId: 'import-bio',
          sourceLabel: 'CF610_G',
          tipoDeLaudo: 'BIOIMPEDANCE',
          atributos: null,
        },
      ],
    };

    expect(atributosDoAparelho(sessao)).toBeNull();
  });
});

describe('metas e controle — recomendações do aparelho (INV-151)', () => {
  /** Uma sessão com os atributos que o extrator grava, sem o resto do ruído. */
  function sessaoCom(atributos: Record<string, unknown> | null): SessaoDeRevisao {
    return {
      sessionId: 'sessao-1',
      linhas: [],
      podeConfirmar: { pronta: true },
      arquivos: [
        {
          importId: 'import-bio',
          sourceLabel: 'CF610_G',
          tipoDeLaudo: 'BIOIMPEDANCE',
          atributos,
        },
      ],
    };
  }

  it('lê as cinco recomendações de qualquer arquivo da sessão', () => {
    const recomendacoes = recomendacoesDoAparelho(
      sessaoCom({
        deviceStandardWeightKg: 82.1,
        deviceWeightControlKg: -10.1,
        deviceRecommendedIntakeKcal: 2437,
      }),
    );

    expect(recomendacoes).toEqual({
      deviceStandardWeightKg: 82.1,
      deviceWeightControlKg: -10.1,
      deviceRecommendedIntakeKcal: 2437,
    });
  });

  /**
   * O achado do ECG mora no MESMO `atributos`. Se a leitura fosse por
   * "pega tudo", o card de metas exibiria texto de ECG numa lista de kg.
   */
  it('ignora atributo que não é recomendação', () => {
    expect(
      recomendacoesDoAparelho(
        sessaoCom({ ecgFinding: 'Possivel fibrilacao atrial', deviceStandardWeightKg: 82.1 }),
      ),
    ).toEqual({ deviceStandardWeightKg: 82.1 });
  });

  it('laudo sem recomendação nenhuma devolve null, não objeto vazio', () => {
    expect(recomendacoesDoAparelho(sessaoCom({ ecgFinding: 'Ritmo nao classificado' }))).toBeNull();
    expect(recomendacoesDoAparelho(sessaoCom(null))).toBeNull();
  });

  it('mostra o valor com unidade e preserva o sinal do controle', () => {
    render(
      <MetasEControle
        deviceReport={{
          deviceStandardWeightKg: 82.1,
          deviceWeightControlKg: -10.1,
          deviceMuscleControlKg: 0,
          deviceRecommendedIntakeKcal: 2437,
        }}
      />,
    );

    expect(screen.getByTestId('recomendacao-deviceStandardWeightKg')).toHaveTextContent('82,1 kg');
    // O SINAL é a informação: "10,1 kg" não diz se é para ganhar ou perder.
    // O sinal vem do `Intl` (hífen-menos comum, não o − tipográfico): o teste
    // afirma o que o navegador REALMENTE renderiza, e a regex ancora os dois
    // lados para nao passar por acaso num "110,1".
    expect(screen.getByTestId('recomendacao-deviceWeightControlKg')).toHaveTextContent(
      /^-10,1 kg$/,
    );
    expect(screen.getByTestId('recomendacao-deviceRecommendedIntakeKcal')).toHaveTextContent(
      '2.437 kcal/dia',
    );
  });

  /**
   * Zero é um valor MEDIDO ("controle muscular: 0 kg" = não precisa mudar),
   * não ausência. Tratá-lo como falta esconderia a recomendação de quem lê.
   */
  /**
   * SINAL SÓ NO AJUSTE.
   *
   * "Peso padrão +82,1 kg" lia como se o aluno tivesse de GANHAR 82 kg --
   * 82,1 é o peso de referência que o aparelho calculou, não uma meta de
   * ganho. Já "−10,1 kg" de controle é ajuste: sem o sinal, não se sabe se
   * é para perder ou ganhar.
   */
  it('medida não leva sinal; ajuste leva', () => {
    render(
      <MetasEControle
        deviceReport={{
          deviceStandardWeightKg: 82.1,
          deviceWeightControlKg: -10.1,
          deviceRecommendedIntakeKcal: 2437,
        }}
      />,
    );

    expect(screen.getByTestId('recomendacao-deviceStandardWeightKg')).toHaveTextContent(
      /^82,1 kg$/,
    );
    expect(screen.getByTestId('recomendacao-deviceRecommendedIntakeKcal')).toHaveTextContent(
      /^2\.437 kcal\/dia$/,
    );
    expect(screen.getByTestId('recomendacao-deviceWeightControlKg')).toHaveTextContent(
      /^-10,1 kg$/,
    );
  });

  it('zero é valor, não ausência', () => {
    render(<MetasEControle deviceReport={{ deviceMuscleControlKg: 0 }} />);

    expect(screen.getByTestId('recomendacao-deviceMuscleControlKg')).toHaveTextContent('0 kg');
  });

  it('não renderiza card nenhum quando o laudo não trouxe recomendação', () => {
    const { container } = render(<MetasEControle deviceReport={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
