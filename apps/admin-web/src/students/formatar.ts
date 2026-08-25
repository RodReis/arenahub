/**
 * Formatação da recepção — F7, Slice 1.2.
 *
 * Funções puras, testáveis sem montar componente. O que elas resolvem não é
 * estética: a recepção precisa responder "o acesso vale agora?" olhando a
 * tela, não interpretando `startMinute: 1080` enquanto o aluno espera.
 */

/**
 * Rótulos de situação do aluno em pt-BR.
 *
 * Os sete valores de `StudentStatus`. `SUSPENDED` é o caso perigoso de
 * traduzir errado: ele **continua elegível a acesso** (INV-033 e `M1-BR-002`
 * listam só `BLOCKED`, `CANCELLED` e `ARCHIVED`). Chamá-lo de "sem acesso"
 * faria a recepção liberar manualmente quem já podia entrar sozinho.
 */
export const ROTULO_DE_SITUACAO: Record<string, string> = {
  LEAD: 'Interessado',
  TRIAL: 'Experimental',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
  CANCELLED: 'Cancelado',
  ARCHIVED: 'Arquivado',
};

/**
 * Situações que impedem o acesso — `domain/student.ts`, INV-033.
 *
 * Espelha a regra do servidor para a tela poder avisar antes de a recepção
 * tentar atribuir um plano que não vai liberar ninguém. Quem decide o acesso
 * continua sendo o Access Decision Engine; isto é aviso, não decisão.
 */
const SITUACOES_SEM_ACESSO = new Set(['BLOCKED', 'CANCELLED', 'ARCHIVED']);

export function impedeAcesso(situacao: string): boolean {
  return SITUACOES_SEM_ACESSO.has(situacao);
}

/**
 * Transições válidas de `Student` — espelho de `TRANSICOES_DE_ALUNO`.
 *
 * Serve para a tela oferecer só o que a API aceita. Sem isso, o select
 * mostraria as sete situações e a recepção descobriria o erro depois do
 * clique, com um 409 traduzido.
 *
 * `ARCHIVED` é terminal: conjunto vazio, nenhuma saída.
 */
export const TRANSICOES_DE_SITUACAO: Record<string, readonly string[]> = {
  LEAD: ['TRIAL', 'ACTIVE', 'CANCELLED', 'ARCHIVED'],
  TRIAL: ['ACTIVE', 'CANCELLED', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
  BLOCKED: ['ACTIVE', 'CANCELLED', 'ARCHIVED'],
  CANCELLED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function situacoesPossiveis(atual: string): readonly string[] {
  return TRANSICOES_DE_SITUACAO[atual] ?? [];
}

/** Rótulos de estado do entitlement. */
export const ROTULO_DE_ENTITLEMENT: Record<string, string> = {
  SCHEDULED: 'Agendado',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  REVOKED: 'Revogado',
  EXPIRED: 'Expirado',
};

/**
 * Origem do direito de acesso — `EntitlementSource`, enum extensível (ADR-009).
 *
 * Nove valores hoje; convênio corporativo já tem lugar no enum mesmo fora do
 * roadmap. Código desconhecido cai para si mesmo via `traduzir`.
 */
export const ROTULO_DE_ORIGEM: Record<string, string> = {
  SUBSCRIPTION: 'Assinatura',
  COURTESY: 'Cortesia',
  EMPLOYEE: 'Funcionário',
  PERSONAL_TRAINER: 'Personal trainer',
  VISITOR: 'Visitante',
  TRIAL_CLASS: 'Aula experimental',
  DEPENDENT: 'Dependente',
  PARTNER: 'Parceiro',
  CORPORATE: 'Convênio corporativo',
};

/** Rótulos de situação da assinatura. */
/**
 * O que a coluna PLANO da listagem mostra.
 *
 * O ALUNO TINHA ACESSO E A LISTA DIZIA QUE NAO. `planName` vem da assinatura
 * vigente, e direito que nasce de VINCULO -- cortesia, funcionario, personal
 * trainer, dependente -- nao tem assinatura nenhuma: a ficha mostrava "Ativo,
 * Personal trainer, vale agora" e a MESMA pessoa aparecia com "—" na lista.
 * Eram 33 alunos da bancada, e a recepcao olha a lista para decidir se libera.
 *
 * ASSINATURA VENCE: quem tem plano de verdade ve o NOME dele ("Mensal Fit"),
 * nao a palavra "Assinatura" -- trocar o nome pela origem pioraria o caso
 * comum para consertar o raro.
 *
 * Devolve `null` quando nao ha acesso nenhum: interessado que ainda nao
 * assinou nao pode ganhar rotulo, senao a lista responde que ele tem algo.
 */
export function planoDaListagem(
  planName: string | null,
  accessSource: string | null,
): string | null {
  if (planName !== null) return planName;
  if (accessSource === null || accessSource === 'SUBSCRIPTION') return null;

  // Origem desconhecida cai no proprio codigo, nunca em branco: enum novo na
  // API apareceria como celula vazia, indistinguivel de "sem acesso".
  return ROTULO_DE_ORIGEM[accessSource] ?? accessSource;
}

export const ROTULO_DE_ASSINATURA: Record<string, string> = {
  PENDING: 'Pendente',
  ACTIVE: 'Ativa',
  // Inalcançável no MVP 1 — nenhuma transição chega aqui antes do MVP 2.
  PAST_DUE: 'Em atraso',
  PAUSED: 'Pausada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Expirada',
};

/**
 * Eventos da timeline em pt-BR — `StudentTimelineEventType`.
 *
 * Os 20 tipos que o servidor emite. Um tipo novo aparece com o código cru:
 * feio, mas honesto — esconder o evento desconhecido apagaria justamente o
 * caso que ninguém previu.
 */
export const ROTULO_DE_EVENTO: Record<string, string> = {
  STUDENT_CREATED: 'Aluno cadastrado',
  STUDENT_UPDATED: 'Cadastro alterado',
  STUDENT_STATUS_CHANGED: 'Situação alterada',
  STUDENT_ARCHIVED: 'Aluno arquivado',
  SUBSCRIPTION_CREATED: 'Assinatura criada',
  SUBSCRIPTION_ACTIVATED: 'Assinatura ativada',
  SUBSCRIPTION_PAUSED: 'Assinatura pausada',
  SUBSCRIPTION_RESUMED: 'Assinatura retomada',
  SUBSCRIPTION_CANCELLED: 'Assinatura cancelada',
  SUBSCRIPTION_EXPIRED: 'Assinatura expirada',
  ENTITLEMENT_GRANTED: 'Direito de acesso concedido',
  ENTITLEMENT_SUSPENDED: 'Direito de acesso suspenso',
  ENTITLEMENT_RESUMED: 'Direito de acesso retomado',
  ENTITLEMENT_REVOKED: 'Direito de acesso revogado',
  ENTITLEMENT_EXPIRED: 'Direito de acesso expirado',
  CONSENT_GRANTED: 'Consentimento registrado',
  CONSENT_REVOKED: 'Consentimento revogado',
  BIOMETRIC_IDENTITY_CREATED: 'Biometria cadastrada',
  BIOMETRIC_IDENTITY_SYNCED: 'Biometria sincronizada',
  BIOMETRIC_IDENTITY_DELETED: 'Biometria removida',
};

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * Dia da semana da janela de acesso.
 *
 * `dayOfWeek` é 0..6 (0 = domingo), o eixo do motor de decisão -- ver #129.
 * Fora da faixa vira '—' em vez de `undefined`, que apareceria literalmente na
 * tabela.
 *
 * A faixa é conferida antes de indexar porque `?? '—'` não pega string vazia:
 * sem a checagem, um índice inválido deixaria a célula em branco, parecendo
 * dado faltando em vez de dado inválido.
 */
export function diaDaSemana(dia: number): string {
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) return '—';

  return DIAS[dia]!;
}

/**
 * Minuto do dia como hora legível.
 *
 * `1080` não diz nada para quem atende; `18:00` diz. `1440` é meia-noite do
 * dia seguinte e é válido como fim de janela — `24:00` comunica "vai até o fim
 * do dia" melhor que `00:00`, que pareceria uma janela de duração zero.
 */
export function horaDoMinuto(minuto: number): string {
  if (!Number.isInteger(minuto) || minuto < 0 || minuto > 1440) return '—';

  const hora = Math.floor(minuto / 60);
  const resto = minuto % 60;

  return `${String(hora).padStart(2, '0')}:${String(resto).padStart(2, '0')}`;
}

/** Janela de acesso em uma linha: "Segunda, 06:00–22:00". */
export function janelaLegivel(janela: {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}): string {
  return `${diaDaSemana(janela.dayOfWeek)}, ${horaDoMinuto(janela.startMinute)}–${horaDoMinuto(janela.endMinute)}`;
}

/**
 * O direito de acesso vale neste instante?
 *
 * Responde só a pergunta de vigência — `status` ativo e `agora` dentro do
 * intervalo. **Não** avalia janela de horário nem unidade: quem decide o
 * acesso é o Access Decision Engine (ADR-004), e duplicar a decisão aqui
 * criaria uma segunda verdade que diverge na primeira mudança de regra.
 */
export function vigenteAgora(
  entitlement: { status: string; startsAt: string; endsAt: string },
  agora: Date = new Date(),
): boolean {
  if (entitlement.status !== 'ACTIVE') return false;

  const inicio = new Date(entitlement.startsAt).getTime();
  const fim = new Date(entitlement.endsAt).getTime();

  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return false;

  const instante = agora.getTime();

  return instante >= inicio && instante <= fim;
}
