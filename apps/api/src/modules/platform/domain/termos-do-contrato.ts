/**
 * Texto das clausulas do contrato, por versao -- F70 (ADR-055, SPEC-070 §4).
 *
 * VERSIONADO E IMUTAVEL POR CHAVE. O contrato grava qual versao fechou
 * (`TenantContract.termsVersion`) e o gerador de PDF le SEMPRE esta tabela
 * pela chave gravada -- nunca "a versao mais recente". Regerar o documento
 * anos depois reproduz o texto de quando foi fechado, a mesma regra que ja
 * vale para os precos copiados (ADR-052 §8) aplicada ao texto. Editar uma
 * versao JA USADA por algum contrato reescreveria retroativamente o que foi
 * assinado -- por isso versao nova e o UNICO jeito de mudar uma clausula.
 *
 * NAO E PECA JURIDICA REVISADA POR ADVOGADO (ADR-055, "Limite do que isto
 * e"). O texto foi redigido pelo Cowork a pedido do PI em 11/09/2026.
 */

/** Uma clausula com numero e paragrafos -- a unidade que o PDF imprime. */
export interface ClausulaDoContrato {
  readonly titulo: string;
  readonly paragrafos: readonly string[];
}

export interface TermosDoContrato {
  readonly versao: string;
  readonly clausulas: readonly ClausulaDoContrato[];
}

/**
 * Marca de campo cujo valor o PI ainda nao decidiu (SPEC-070 §7) -- fica
 * visivel no PDF de proposito. Um contrato com esta marca nao e documento
 * pronto para assinar: ver ADR-055, "Limite do que isto e".
 */
export const A_DEFINIR = '[a definir pelo PI]';

/**
 * Versao `2026.1` -- a unica que existe nesta fatia. Texto de
 * `SPEC-070-contrato-com-clausulas-e-assinatura.md` §4, com os campos
 * marcados `⟪⟫` na spec substituidos por `A_DEFINIR` aqui.
 */
const VERSAO_2026_1: TermosDoContrato = {
  versao: '2026.1',
  clausulas: [
    {
      titulo: 'Cláusula 1 — Objeto',
      paragrafos: [
        '1.1. A CONTRATADA licencia à CONTRATANTE, em caráter não exclusivo, intransferível e pelo prazo deste contrato, o uso do sistema ArenaHub, plataforma de gestão para academias disponibilizada em regime de software como serviço (SaaS) e acessada pela internet, nas superfícies descritas no Quadro resumo.',
        '1.2. Este contrato não é de desenvolvimento de software sob encomenda. Correções, melhorias e funcionalidades novas — inclusive as sugeridas pela CONTRATANTE — integram o produto e permanecem de titularidade exclusiva da CONTRATADA, sem que disso decorra qualquer direito de propriedade, exclusividade ou participação da CONTRATANTE.',
        `1.3. A CONTRATADA poderá alterar, evoluir e descontinuar funcionalidades do produto, desde que não suprima função essencial ao uso contratado sem aviso prévio de ${A_DEFINIR} dias.`,
        '1.4. O ArenaHub não emite documento fiscal, não substitui sistema contábil, não é prontuário médico, não é instituição de pagamento ou adquirente e não substitui prescrição ou avaliação de profissional de educação física ou de saúde. As informações produzidas por recursos automatizados do sistema têm caráter informativo e não constituem diagnóstico.',
      ],
    },
    {
      titulo: 'Cláusula 2 — Superfícies contratadas',
      paragrafos: [
        '2.1. O painel administrativo web integra todo contrato.',
        '2.2. O aplicativo do aluno e o totem de autoatendimento são contratados individualmente, conforme assinalado no Quadro resumo.',
        '2.3. Superfície não contratada não é disponibilizada. Sua ativação depende de aditivo ou de novo contrato.',
      ],
    },
    {
      titulo: 'Cláusula 3 — Implantação',
      paragrafos: [
        '3.1. A CONTRATADA realiza a configuração inicial do ambiente, a importação da base de alunos a partir de arquivo fornecido pela CONTRATANTE e a instalação dos componentes que operam na academia.',
        '3.2. O resultado da importação depende da qualidade do arquivo entregue. Dado ausente, duplicado ou inconsistente na origem não é recriado pela CONTRATADA, e sua correção posterior é da CONTRATANTE.',
        '3.3. Cabem à CONTRATANTE, às suas expensas, o computador da recepção, o equipamento de controle de acesso e seus acessórios, a energia elétrica e a conexão de internet do local.',
      ],
    },
    {
      titulo: 'Cláusula 4 — Preço, reajuste e pagamento',
      paragrafos: [
        '4.1. A remuneração é a do Quadro resumo, no modelo ali indicado.',
        '4.2. No modelo por aluno, considera-se aluno ativo aquele em situação ativa no dia da emissão da fatura, e aluno inativo qualquer outra situação cadastral. A apuração é feita no dia da emissão e não se altera por mudanças posteriores.',
        `4.3. A fatura é emitida no dia indicado no Quadro resumo, com vencimento em ${A_DEFINIR} dias.`,
        '4.4. O valor é reajustado anualmente, na data de aniversário indicada no Quadro resumo, pela variação acumulada do índice ali previsto nos doze meses anteriores. Extinto o índice, aplica-se o que oficialmente o substituir; na ausência de substituto, as partes acordarão índice equivalente.',
        '4.5. Os valores não incluem tributos que venham a incidir sobre a operação e que sejam de responsabilidade da CONTRATANTE.',
        `4.6. O atraso sujeita a CONTRATANTE a multa de ${A_DEFINIR}% e juros de ${A_DEFINIR}% ao mês, pro rata die, sobre o valor em aberto.`,
      ],
    },
    {
      titulo: 'Cláusula 5 — Inadimplência e suspensão',
      paragrafos: [
        '5.1. Vencida a fatura, a CONTRATANTE dispõe do prazo de carência indicado no Quadro resumo, contado do vencimento, para regularizar.',
        '5.2. Esgotada a carência, a CONTRATADA poderá suspender o acesso ao sistema, inclusive a liberação de acesso de alunos pelo equipamento de controle de acesso, até a regularização.',
        '5.3. A suspensão não apaga dado, não extingue a dívida e não constitui rescisão. Regularizado o pagamento, o acesso é restabelecido.',
        '5.4. A CONTRATANTE é avisada pelo próprio painel desde o vencimento, com indicação do valor em aberto e do prazo restante.',
      ],
    },
    {
      titulo: 'Cláusula 6 — Obrigações da CONTRATADA',
      paragrafos: [
        '6.1. Manter o sistema em funcionamento e disponível pela internet, ressalvadas as hipóteses da Cláusula 11.',
        `6.2. Prestar suporte por ${A_DEFINIR}, em ${A_DEFINIR}, para dúvidas de uso e falhas do sistema.`,
        '6.3. Manter rotina de cópia de segurança dos dados da CONTRATANTE.',
        '6.4. Corrigir, em prazo razoável, os defeitos que impeçam o uso das funções contratadas.',
        '6.5. Comunicar com antecedência as paradas programadas.',
      ],
    },
    {
      titulo: 'Cláusula 7 — Obrigações da CONTRATANTE',
      paragrafos: [
        '7.1. Fornecer e manter atualizados dados cadastrais verdadeiros.',
        '7.2. Guardar as credenciais de acesso, responder pelos usuários que criar e comunicar de imediato qualquer uso indevido.',
        '7.3. Colher dos alunos, na forma da lei, o consentimento para o uso de biometria facial, informando a finalidade, e garantir a quem recusar o acesso por meio alternativo oferecido pelo sistema.',
        '7.4. Não ceder, sublicenciar, revender, alugar, copiar, descompilar ou tentar obter o código-fonte do sistema, nem permitir que terceiro o faça.',
        '7.5. Prover e manter a infraestrutura local descrita na Cláusula 3.3.',
        '7.6. Utilizar o sistema conforme a legislação aplicável à sua atividade.',
      ],
    },
    {
      titulo: 'Cláusula 8 — Propriedade intelectual e titularidade dos dados',
      paragrafos: [
        '8.1. O ArenaHub, seu código-fonte, arquitetura, bases de dados estruturais, marca, identidade visual e documentação são de titularidade exclusiva da CONTRATADA. Este contrato transfere apenas o direito de uso, nos limites da Cláusula 1.',
        '8.2. Os dados inseridos no sistema pela CONTRATANTE — cadastro de alunos, financeiro, avaliações, registros de acesso — são de titularidade da CONTRATANTE. A CONTRATADA não os comercializa, não os cede a terceiros e os utiliza exclusivamente para executar este contrato.',
        '8.3. A CONTRATADA poderá utilizar dados estatísticos agregados e anonimizados, que não permitam identificar a CONTRATANTE nem qualquer titular, para aferir e melhorar o produto.',
        `8.4. Encerrado o contrato, a CONTRATANTE poderá solicitar a exportação de seus dados em formato legível por máquina no prazo de ${A_DEFINIR} dias contados do encerramento. Decorrido o prazo, a CONTRATADA poderá eliminá-los, ressalvada a guarda exigida por lei.`,
      ],
    },
    {
      titulo: 'Cláusula 9 — Proteção de dados pessoais',
      paragrafos: [
        '9.1. Para os fins da Lei nº 13.709/2018, a CONTRATANTE é a controladora dos dados pessoais tratados no sistema, e a CONTRATADA é a operadora, tratando-os exclusivamente conforme as instruções da controladora e para executar este contrato.',
        '9.2. A CONTRATANTE declara possuir base legal adequada para o tratamento que realiza e responde pela relação com os titulares.',
        '9.3. A biometria facial é dado pessoal sensível. A definição da base legal e a coleta do consentimento são de responsabilidade da CONTRATANTE. O sistema registra a versão e a data do consentimento de cada aluno, permite sua revogação e mantém meio alternativo de identificação para quem não consentir — sem prejuízo do acesso.',
        `9.4. A CONTRATADA adota medidas técnicas de proteção compatíveis com a natureza dos dados e comunicará à CONTRATANTE, em até ${A_DEFINIR} horas do conhecimento, incidente de segurança que possa acarretar risco relevante aos titulares.`,
        '9.5. Pedido de titular recebido pela CONTRATADA é encaminhado à CONTRATANTE, a quem cabe respondê-lo; a CONTRATADA presta o apoio técnico necessário.',
        '9.6. A CONTRATANTE autoriza a CONTRATADA a utilizar prestadores de infraestrutura em nuvem para hospedagem e processamento, permanecendo a CONTRATADA responsável perante a CONTRATANTE pelos serviços que subcontratar.',
        '9.7. Encerrado o contrato, aplica-se a Cláusula 8.4 quanto à devolução e à eliminação.',
      ],
    },
    {
      titulo: 'Cláusula 10 — Confidencialidade',
      paragrafos: [
        '10.1. Cada parte se obriga a manter sigilo sobre informações técnicas, comerciais, financeiras e operacionais da outra a que tenha acesso em razão deste contrato, e a não utilizá-las para finalidade distinta da sua execução.',
        '10.2. A obrigação não alcança informação que já fosse pública, que se torne pública sem culpa da parte receptora, ou cuja divulgação seja exigida por autoridade competente — caso em que a outra parte será informada, quando permitido.',
        `10.3. O dever de sigilo subsiste por ${A_DEFINIR} anos após o término deste contrato.`,
      ],
    },
    {
      titulo: 'Cláusula 11 — Limitação de responsabilidade',
      paragrafos: [
        '11.1. A CONTRATADA não responde por indisponibilidade ou falha decorrente de: interrupção de energia elétrica ou de conexão de internet no local; defeito, configuração ou substituição de equipamento de controle de acesso, computador ou rede da CONTRATANTE; ato de terceiro fornecedor de equipamento; uso em desacordo com este contrato; ou caso fortuito e força maior.',
        '11.2. A CONTRATADA não responde por lucros cessantes, perda de oportunidade ou danos indiretos.',
        `11.3. A responsabilidade total da CONTRATADA, por qualquer causa, fica limitada a ${A_DEFINIR}.`,
        '11.4. A limitação não se aplica a dolo.',
      ],
    },
    {
      titulo: 'Cláusula 12 — Vigência, renovação e rescisão',
      paragrafos: [
        '12.1. A vigência é a do Quadro resumo. Sendo por prazo indeterminado, o contrato permanece válido até que uma das partes o encerre na forma desta cláusula.',
        `12.2. Qualquer das partes pode rescindir imotivadamente, mediante aviso por escrito com ${A_DEFINIR} dias de antecedência.`,
        `12.3. A CONTRATADA pode rescindir de pleno direito se a inadimplência ultrapassar ${A_DEFINIR} dias do vencimento, ou em caso de violação das Cláusulas 7.4, 8.1 ou 10.`,
        '12.4. A rescisão não dispensa o pagamento dos valores relativos ao período efetivamente utilizado.',
        '12.5. Encerrado o contrato, aplicam-se as Cláusulas 8.4 e 9.7.',
      ],
    },
    {
      titulo: 'Cláusula 13 — Disposições gerais',
      paragrafos: [
        '13.1. Alterações só valem por aditivo escrito.',
        '13.2. A tolerância quanto ao descumprimento de qualquer cláusula não implica novação nem renúncia.',
        '13.3. A nulidade de uma cláusula não contamina as demais.',
        `13.4. As partes elegem o foro da comarca de ${A_DEFINIR}, com renúncia a qualquer outro.`,
      ],
    },
  ],
};

const TODAS_AS_VERSOES: Readonly<Record<string, TermosDoContrato>> = {
  '2026.1': VERSAO_2026_1,
};

/** A versao mais recente -- usada SO ao fechar contrato NOVO, nunca ao ler um existente. */
export const VERSAO_ATUAL_DOS_TERMOS = '2026.1';

export class VersaoDeTermosDesconhecidaError extends Error {
  constructor(readonly versao: string) {
    super(`Versão de termos desconhecida: ${versao}`);
  }
}

/**
 * Os termos da versao pedida -- SEMPRE pela chave gravada no contrato, nunca
 * "a atual". Ver o comentario do modulo.
 */
export function termosDaVersao(versao: string): TermosDoContrato {
  const termos = TODAS_AS_VERSOES[versao];

  if (!termos) throw new VersaoDeTermosDesconhecidaError(versao);

  return termos;
}
