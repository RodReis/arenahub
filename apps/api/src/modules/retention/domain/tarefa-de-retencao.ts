/**
 * A maquina de estados da tarefa de retencao (F38, Slice 6.3).
 *
 * PURA: sem banco, sem relogio. Recebe a tarefa e um comando, devolve a tarefa
 * nova -- nunca muta a recebida.
 *
 * ---------------------------------------------------------------------------
 * A SETA DO MVP 6 PASSA AQUI
 * ---------------------------------------------------------------------------
 *
 * A entrega do MVP inteiro e "risco de churn explicavel -> TAREFA OPERACIONAL".
 * A F37 entregou o lado esquerdo da seta; sem esta fatia o score e relatorio,
 * nao acao. O aceite da Slice 6.3 e literal: "cada intervencao liga score,
 * acao, responsavel e resultado" -- e sao esses quatro que a maquina amarra.
 *
 * ---------------------------------------------------------------------------
 * CONCLUIR EXIGE RESULTADO. DISPENSAR EXIGE MOTIVO.
 * ---------------------------------------------------------------------------
 *
 * As duas saidas terminais que uma pessoa escolhe pedem justificativa, e o tipo
 * nao deixa passar sem. Tarefa concluida sem resultado quebra `M6-AC-006` ("a
 * interacao registra responsavel, canal, horario e resultado") e, pior, some
 * com a unica evidencia do que a retencao produziu: uma fila cheia de
 * `CONCLUIDA` sem resultado nao diz se alguem foi contatado ou se a recepcao
 * so limpou a tela.
 *
 * `EXPIRAR` e a excecao: e o sistema quem aplica, no fim do SLA, e nao ha
 * pessoa para justificar. Por isso ela NAO alcanca `EM_ATENDIMENTO` -- quem
 * esta com a tarefa na mao nao pode te-la puxada por baixo no meio da ligacao.
 */

/**
 * Os estados da tarefa.
 *
 * `ABERTA` -> `ATRIBUIDA` -> `EM_ATENDIMENTO` -> terminal. As tres terminais
 * sao distintas de proposito: `CONCLUIDA` teve contato, `DISPENSADA` foi
 * descartada por uma pessoa com motivo, `EXPIRADA` estourou o SLA sem ninguem
 * tocar. Colapsa-las esconderia a metrica que diz se a fila esta grande demais.
 */
export type EstadoDeTarefa =
  | 'ABERTA'
  | 'ATRIBUIDA'
  | 'EM_ATENDIMENTO'
  | 'CONCLUIDA'
  | 'DISPENSADA'
  | 'EXPIRADA';

/**
 * Os estados que ocupam vaga na fila.
 *
 * Esta lista e o que o INDICE PARCIAL do banco usa para impedir duas tarefas
 * ativas do mesmo aluno e estrategia (`M6-FR-007`). Ela e o predicado, e o
 * teste que a compara com `estaAtiva` existe porque as duas definicoes
 * divergirem em silencio e exatamente como um aluno receberia duas ligacoes
 * pelo mesmo motivo.
 */
export const ESTADOS_ATIVOS = ['ABERTA', 'ATRIBUIDA', 'EM_ATENDIMENTO'] as const;

/**
 * O que aconteceu quando alguem tratou a tarefa.
 *
 * `CANAL_INDISPONIVEL` nao e detalhe: com WhatsApp como canal unico (decisao do
 * PI em 31/08/2026), aluno sem numero cadastrado e um caso REAL e frequente, e
 * ele precisa ser distinguivel de `SEM_RESPOSTA`. Um diz "tente outro caminho",
 * o outro diz "tente de novo mais tarde".
 *
 * `RESOLVIDO_DE_OUTRO_MODO` cobre o aluno que voltou a treinar sozinho antes da
 * ligacao -- resultado bom que nao veio da intervencao, e contabiliza-lo como
 * `CONTATADO` inflaria o efeito medido do CRM.
 */
export const RESULTADOS_DE_TAREFA = [
  'CONTATADO',
  'SEM_RESPOSTA',
  'CANAL_INDISPONIVEL',
  'RECUSOU',
  'RETORNAR_DEPOIS',
  'RESOLVIDO_DE_OUTRO_MODO',
] as const;

export type ResultadoDeTarefa = (typeof RESULTADOS_DE_TAREFA)[number];

export interface TarefaDeRetencao {
  readonly id: string;
  readonly estado: EstadoDeTarefa;
  readonly responsavelId: string | null;
  readonly resultado: ResultadoDeTarefa | null;
  readonly motivo: string | null;
}

export type ComandoDeTarefa =
  | { readonly tipo: 'ATRIBUIR'; readonly responsavelId: string }
  | { readonly tipo: 'INICIAR' }
  | { readonly tipo: 'CONCLUIR'; readonly resultado: ResultadoDeTarefa }
  | { readonly tipo: 'DISPENSAR'; readonly motivo: string }
  | { readonly tipo: 'EXPIRAR' };

export function estaAtiva(estado: EstadoDeTarefa): boolean {
  return (ESTADOS_ATIVOS as readonly EstadoDeTarefa[]).includes(estado);
}

function recusar(tarefa: TarefaDeRetencao, comando: ComandoDeTarefa): never {
  throw new Error(
    `TRANSICAO_INVALIDA: ${comando.tipo} nao se aplica a tarefa ${tarefa.id} em ${tarefa.estado}`,
  );
}

/**
 * Aplica um comando a uma tarefa.
 *
 * Lanca em vez de devolver a tarefa intacta: transicao invalida e erro de
 * programacao ou requisicao fora de ordem, e engolir em silencio faria a tela
 * mostrar "concluida" para uma tarefa que nunca saiu de `ABERTA`.
 */
export function transitar(
  tarefa: TarefaDeRetencao,
  comando: ComandoDeTarefa,
): TarefaDeRetencao {
  // Terminal e terminal: nenhuma transicao sai de la. O historico e
  // append-only, e reabrir tarefa apagaria a evidencia do que foi feito.
  if (!estaAtiva(tarefa.estado)) {
    recusar(tarefa, comando);
  }

  switch (comando.tipo) {
    case 'ATRIBUIR':
      // Vale para `ABERTA` (atribuir) e `ATRIBUIDA` (reatribuir). Nao vale
      // para `EM_ATENDIMENTO`: trocar o responsavel no meio da ligacao
      // perderia o vinculo entre quem falou e o resultado registrado.
      if (tarefa.estado === 'EM_ATENDIMENTO') {
        recusar(tarefa, comando);
      }
      return { ...tarefa, estado: 'ATRIBUIDA', responsavelId: comando.responsavelId };

    case 'INICIAR':
      if (tarefa.estado !== 'ATRIBUIDA') {
        recusar(tarefa, comando);
      }
      return { ...tarefa, estado: 'EM_ATENDIMENTO' };

    case 'CONCLUIR': {
      if (tarefa.estado !== 'EM_ATENDIMENTO') {
        recusar(tarefa, comando);
      }
      if (!RESULTADOS_DE_TAREFA.includes(comando.resultado)) {
        throw new Error(`RESULTADO_OBRIGATORIO: tarefa ${tarefa.id} exige resultado valido`);
      }
      return { ...tarefa, estado: 'CONCLUIDA', resultado: comando.resultado };
    }

    case 'DISPENSAR': {
      const motivo = comando.motivo.trim();
      if (motivo === '') {
        throw new Error(`MOTIVO_OBRIGATORIO: dispensar a tarefa ${tarefa.id} exige motivo`);
      }
      return { ...tarefa, estado: 'DISPENSADA', motivo };
    }

    case 'EXPIRAR':
      // Nao alcanca `EM_ATENDIMENTO` -- ver o cabecalho deste arquivo.
      if (tarefa.estado === 'EM_ATENDIMENTO') {
        recusar(tarefa, comando);
      }
      return { ...tarefa, estado: 'EXPIRADA' };
  }
}
