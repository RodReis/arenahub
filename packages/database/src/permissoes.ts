/**
 * Permissoes do papel OWNER -- FONTE UNICA.
 *
 * Vivia inline no `seed.ts`, e o `bootstrap-tenant` da F58 nasceu com uma
 * COPIA de sete itens. Resultado: o OWNER criado em producao nao enxergava o
 * proprio dashboard (`FORBIDDEN` em `access.read`), enquanto o de
 * desenvolvimento via tudo -- a divergencia so aparecia em producao, que e
 * onde ela custa caro.
 *
 * Quem adicionar permissao nova mexe AQUI, e os dois caminhos recebem juntos.
 */
export const PERMISSOES_DO_OWNER = [
  'tenant.read',
  'tenant.update',
  'unit.create',
  'unit.read',
  'unit.update',
  'user.manage',
  'role.assign',
  // F7: cadastro de aluno, plano e assinatura manual.
  'student.create',
  'student.read',
  'student.update',
  'plan.manage',
  'plan.read',
  'subscription.manage',
  // F8: consentimento, biometria e sincronizacao de dispositivo.
  //
  // `biometric.*` e separado de `student.*` de proposito: quem cadastra aluno
  // na recepcao nao precisa, por isso, enxergar dado biometrico. Dado
  // sensivel do art. 11 pede permissao propria -- e foi falha de controle de
  // acesso que motivou a suspensao da ANPD no caso PR.
  'consent.manage',
  'consent.read',
  'biometric.enroll',
  'biometric.read',
  'biometric.revoke',
  'device.manage',
  'device.read',
  // F30: moderacao de apelido publico. Trabalho de recepcao/operacao, nao de
  // financeiro -- por isso entra na mesma vizinhanca de `student.read` e
  // `consent.manage`, nao junto de `billing.*`.
  'engagement.read',
  'engagement.moderate',
  // F35: corrigir pontuacao e resolver contestacao.
  //
  // Separada de `engagement.moderate` pela mesma razao que
  // `reconciliation.resolve` e separada de `reconciliation.read`: quem julga
  // apelido nao e necessariamente quem mexe no saldo de XP de um aluno.
  //
  // NAO existe segundo ator (ADR-049, Decisao 2). O controle e permissao
  // propria + teto por operacao (`Tenant.engagementCorrectionLimitPoints`),
  // que RECUSA acima do limite em vez de enfileirar para aprovacao -- mesmo
  // precedente de `BillingSettings.refundLimitMinor`.
  'engagement.correct',
  // F9: decisao de acesso e liberacao manual.
  //
  // `access.override` e separado de tudo: quem opera a recepcao no dia a dia
  // consulta eventos (`access.read`), mas ABRIR a catraca a mao e ato
  // excepcional, auditado, que nem todo perfil precisa ter.
  'access.read',
  'access.override',
  // F12: financeiro. `billing.payment.manual` e separado de
  // `billing.manage` pelo mesmo motivo de `access.override`: reconhecer
  // dinheiro sem passar por provedor e ato excepcional, e nem todo perfil
  // do financeiro precisa dele.
  'billing.read',
  'billing.manage',
  'billing.payment.manual',
  // F15: liberacao financeira excepcional. Separada de `billing.manage` pelo
  // mesmo motivo dos dois acima -- liberar o acesso de quem DEVE, sem o
  // pagamento entrar, e ato excepcional com prazo e nome gravados.
  'billing.override.financial',
  // F16: estorno e conciliacao.
  //
  // `billing.refund` e o terceiro ato excepcional do financeiro, pela mesma
  // logica dos dois acima: quem abre invoice nao precisa poder DEVOLVER o
  // dinheiro que ja entrou. Alem da permissao, o estorno exige step-up MFA
  // na propria requisicao (INV-074).
  //
  // `reconciliation.read` e `reconciliation.resolve` sao separadas porque
  // olhar a fila de divergencia e trabalho de conferencia diario, e fecha-la
  // e decisao que assume a diferenca -- quem confere nem sempre e quem
  // decide.
  'billing.refund',
  'reconciliation.read',
  'reconciliation.resolve',
  'receipt.read',
  // Emitir recibo CONSOME numeracao sequencial imutavel -- e escrita, e nao
  // pode ser autorizada pela permissao de leitura.
  'receipt.issue',
  // F17: avaliacao fisica manual e contexto de saude.
  //
  // Separadas de `student.*` pelo mesmo motivo de `biometric.*`: composicao
  // corporal e dado de saude (art. 11), e quem atende a recepcao nao precisa
  // ver o percentual de gordura de ninguem para matricular.
  //
  // `health.assess` e do AVALIADOR, nao da recepcao (ADR-037): quem registra
  // fator de contexto e quem mede, porque o fator so faz sentido junto da
  // medicao que ele explica.
  'health.read',
  'health.assess',
  // ANEXAR sem ver nem editar dado de saude (ADR-039). E o que a recepcao
  // recebe: ela anexa o laudo do aluno, o sistema extrai e publica sozinho,
  // e ela nunca ve o percentual de gordura de ninguem. Mantem a separacao do
  // ADR-037 de pe com o fluxo automatico.
  'health.upload',
  // F54: painel financeiro gerencial.
  //
  // Separada de `billing.read` pelo mesmo motivo de `biometric.*`: o que a
  // RECEPCAO precisa e achar a fatura de UM aluno no balcao. O painel
  // consolida o tenant inteiro -- faturamento, ticket medio e taxa de
  // inadimplencia --, e quem atende na porta nao precisa disso para
  // trabalhar. Decisao do PI em 25/08/2026 (`SPEC-054` §8, pergunta 3).
  'billing.dashboard',
  // F37: fila de risco de churn explicavel.
  //
  // Separada de `student.read` pelo mesmo motivo de `billing.dashboard`: ler a
  // ficha de UM aluno no balcao e trabalho de recepcao; ver a academia inteira
  // ordenada por risco de sair e uma leitura gerencial sobre a base toda.
  //
  // `retention.suppress` e separada de `retention.read` pela logica dos atos
  // excepcionais (`access.override`, `billing.refund`): tirar um aluno da fila
  // e decisao com nome e motivo gravados, e `M6-BR-007` exige o motivo por
  // escrito.
  'retention.read',
  'retention.suppress',
  // F38: tratar a tarefa da fila -- atribuir, iniciar, registrar contato,
  // concluir e dispensar.
  //
  // Separada de `retention.read` pelo precedente dos atos excepcionais
  // (`access.override`, `billing.refund`): olhar a fila de risco é leitura
  // gerencial; DISPENSAR uma tarefa é decisão com motivo gravado, e concluir
  // afirma que alguém falou com o aluno. Quem consulta o painel não
  // necessariamente responde pela conversa.
  'retention.task.manage',
  // F41: parar o scoring da academia inteira sem deploy.
  //
  // Separada de `retention.read` pelo precedente dos atos excepcionais
  // (`access.override`, `billing.refund`): acompanhar o painel de saude e
  // trabalho de rotina; DESLIGAR o pipeline afeta todo mundo e e decisao de
  // operacao, nao de consulta.
  'retention.kill_switch',
];
