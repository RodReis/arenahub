# PRD técnico — MVP 2: Smart Billing

## 1. Controle

- Status: APROVADO para planejamento em 14/08/2026
- Dependência: MVP 1 concluído e estável
- Resultado: confirmação financeira ativa ou restaura entitlement automaticamente
- Princípio: pagamento é evento financeiro; entitlement continua sendo a única fonte de decisão de acesso
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Objetivo

Automatizar cobrança, pagamento, recorrência, inadimplência e reconciliação sem acoplar a catraca ao provedor financeiro. O sistema deve processar webhooks duplicados ou fora de ordem com segurança, aplicar carência configurável e refletir confirmação de pagamento no acesso com latência operacional mensurável.

## 3. Métricas de sucesso

- nenhuma cobrança ou confirmação processada duas vezes logicamente;
- 100% dos movimentos do provedor reconciliáveis com registros internos;
- p95 entre webhook válido de pagamento confirmado e entitlement ativo menor que 30 segundos;
- divergências de conciliação visíveis no mesmo dia operacional;
- zero dado completo de cartão armazenado ou registrado pelo ArenaHub;
- bloqueios e desbloqueios reproduzíveis a partir de eventos auditados.

## 4. Personas e permissões

| Persona | Capacidades |
|---|---|
| Financeiro | invoices, cobranças, conciliação, negociação e relatórios |
| Gerente | consulta financeira, descontos limitados e regras de carência |
| Recepcionista | consulta de situação, geração de PIX e registro manual autorizado |
| Proprietário | configuração do provedor, políticas e limites de aprovação |
| Super Admin | suporte técnico sem acesso desnecessário a dados de pagamento |

Permissões adicionais:

```text
billing.read, billing.configure
invoice.create, invoice.cancel
payment.create, payment.record_manual, payment.refund
discount.apply, discount.approve
reconciliation.read, reconciliation.resolve
receipt.read
```

## 5. Gate de homologação do provedor

Antes da Slice 2.2, uma decisão registrada deve comparar ao menos:

- PIX cobrança e expiração;
- cartão tokenizado e recorrência;
- webhooks assinados e reenvio;
- idempotência oferecida;
- sandbox e qualidade da documentação;
- estorno e cancelamento;
- conciliação e extrato;
- taxas, SLA e suporte;
- requisitos de CNPJ, conta recebedora e modelo marketplace;
- LGPD, PCI DSS e retenção.

O provedor escolhido é implementado atrás de `PaymentProvider`. Um segundo provedor não faz parte deste MVP.

PIX, cartão tokenizado e recorrência são capacidades obrigatórias do gate. Provedor que não suporte uma delas não pode ser homologado como único adapter deste MVP.

## 6. Escopo

### Incluído

- configuração financeira por tenant;
- catálogo de preços dos planos existentes;
- invoices e itens;
- pagamento manual controlado;
- PIX via provedor homologado;
- cartão tokenizado e recorrência pelo provedor homologado;
- webhooks autenticados;
- idempotência e ordenação lógica de eventos;
- carência, inadimplência, bloqueio e desbloqueio;
- cancelamento, estorno e refund suportados pelo provedor;
- recibo simples, não fiscal;
- conciliação e painel de exceções;
- notificações internas de eventos financeiros.

### Fora de escopo

- emissão de nota fiscal;
- split marketplace;
- antecipação de recebíveis;
- contabilidade/ERP;
- múltiplas moedas;
- cobrança internacional;
- motor tributário;
- dunning multicanal sofisticado;
- billing da assinatura SaaS do tenant.

## 7. Slices verticais

### Slice 2.1 — Ledger operacional e invoice

- configurações financeiras por tenant;
- invoice, itens e numeração;
- criação pelo ciclo da assinatura;
- pagamento manual com dupla permissão quando acima do limite;
- timeline e auditoria financeira.

Aceite: o financeiro gera e acompanha uma invoice sem alterar entitlement diretamente.

### Slice 2.2 — PIX e webhook idempotente

- `PaymentProvider` e adapter homologado;
- geração de cobrança PIX;
- QR Code e código copia-e-cola;
- endpoint de webhook com verificação de autenticidade;
- inbox idempotente e consulta ativa de confirmação quando necessária;
- pagamento confirmado → invoice paga → assinatura ativa → entitlement ativo.

Aceite: PIX sandbox e homologação atualizam o acesso uma única vez mesmo com webhook repetido.

### Slice 2.3 — Cartão e recorrência

- tokenização hospedada pelo provedor;
- criação e troca de método tokenizado;
- cobrança recorrente;
- falha de cobrança e próxima tentativa;
- cancelamento da recorrência.

Aceite: ArenaHub nunca recebe PAN/CVV e representa corretamente sucesso, falha e cancelamento.

### Slice 2.4 — Inadimplência e acesso

- job de vencimento idempotente;
- período de carência por política;
- assinatura `PAST_DUE`;
- suspensão/revogação de entitlement;
- desbloqueio após compensação;
- override financeiro excepcional auditado e com expiração.

Aceite: a linha do tempo vencimento → carência → bloqueio → pagamento → desbloqueio segue datas e políticas configuradas.

### Slice 2.5 — Estorno, conciliação e operação

- cancelamento/estorno/refund conforme capacidade do provedor;
- importação ou consulta de extrato;
- conciliação automática e fila de divergências;
- recibo e exportação;
- painel de saúde dos webhooks;
- runbook de reprocessamento seguro.

Aceite: operador resolve divergência sem editar banco e sem duplicar efeito financeiro.

## 8. Requisitos funcionais

- `M2-FR-001`: configurar moeda BRL, vencimento, carência e política de bloqueio por tenant.
- `M2-FR-002`: gerar invoice única por assinatura e período de cobrança.
- `M2-FR-003`: manter itens, subtotal, desconto e total imutáveis após pagamento.
- `M2-FR-004`: registrar pagamento manual com ator, evidência, razão e limite de aprovação.
- `M2-FR-005`: criar cobrança PIX e armazenar apenas dados necessários do provedor.
- `M2-FR-006`: consultar status da cobrança quando webhook estiver atrasado ou inconclusivo.
- `M2-FR-007`: verificar assinatura e origem de todo webhook antes de processá-lo.
- `M2-FR-008`: processar uma única transição lógica por evento externo.
- `M2-FR-009`: aceitar eventos fora de ordem sem regredir estado terminal válido.
- `M2-FR-010`: ativar assinatura e entitlement após confirmação financeira elegível.
- `M2-FR-011`: tokenizar cartão fora da infraestrutura ArenaHub.
- `M2-FR-012`: representar tentativa recorrente, falha, próxima tentativa e cancelamento.
- `M2-FR-013`: marcar invoice vencida por job reexecutável.
- `M2-FR-014`: aplicar carência antes do bloqueio quando configurada.
- `M2-FR-015`: suspender entitlement sem apagar histórico.
- `M2-FR-016`: restaurar entitlement após compensação elegível.
- `M2-FR-017`: solicitar estorno/refund e acompanhar estado até conclusão.
- `M2-FR-018`: gerar recibo não fiscal com identificadores verificáveis.
- `M2-FR-019`: conciliar movimentos internos e externos.
- `M2-FR-020`: listar e resolver divergências com auditoria.

## 9. Regras de negócio

- `M2-BR-001`: valores são inteiros na menor unidade monetária; nunca `float`.
- `M2-BR-002`: invoice paga não pode voltar a aberta; refund cria estado e movimento próprios.
- `M2-BR-003`: webhook não confia em tenant enviado no payload; a conta/configuração do provedor resolve o tenant.
- `M2-BR-004`: confirmação do provedor prevalece sobre retorno visual do checkout.
- `M2-BR-005`: pagamento parcial não ativa plano integral salvo política explícita fora deste MVP.
- `M2-BR-006`: desconto não altera retroativamente invoice paga.
- `M2-BR-007`: bloqueio ocorre no primeiro instante após vencimento + carência, respeitando timezone contratual.
- `M2-BR-008`: pagamento confirmado durante backlog ativa entitlement mesmo que o webhook chegue após consulta ativa.
- `M2-BR-009`: refund não revoga acesso retroativamente; aplica a política vigente a partir da confirmação.
- `M2-BR-010`: ação manual nunca apaga o evento externo original.

## 10. Estados

```text
Invoice: DRAFT | OPEN | PAID | OVERDUE | CANCELLED | REFUNDED
Payment: PENDING | PROCESSING | CONFIRMED | FAILED | CANCELLED | REFUND_PENDING | REFUNDED
PaymentAttempt: CREATED | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED
Subscription: PENDING | ACTIVE | PAST_DUE | PAUSED | CANCELLED | EXPIRED
Reconciliation: MATCHED | MISSING_INTERNAL | MISSING_EXTERNAL | AMOUNT_MISMATCH | RESOLVED
```

Transições são implementadas por máquina de estados testada. Eventos externos desconhecidos são armazenados de forma segura para análise, sem produzir efeito de negócio.

## 11. Modelo de dados

```text
billing_settings
invoices, invoice_items
payments, payment_attempts
payment_methods      # somente token/referência mascarada
provider_events      # payload protegido, retenção definida
refunds
reconciliation_runs, reconciliation_items
receipts
outbox_events, inbox_receipts, audit_logs
```

Constraints:

- invoice única por `(tenant_id, subscription_id, billing_period)`;
- evento externo único por `(provider_account_id, external_event_id)`;
- tentativa idempotente por chave enviada ao provedor;
- moeda e valor não podem mudar após abertura da invoice;
- tokens do provedor são cifrados quando persistidos.

## 12. Interface do provedor

```ts
interface PaymentProvider {
  createPix(input: CreatePixInput): Promise<PixCharge>;
  getPaymentStatus(externalPaymentId: string): Promise<ProviderPayment>;
  createTokenizedSubscription(input: SubscriptionInput): Promise<ProviderSubscription>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  refundPayment(input: RefundInput): Promise<ProviderRefund>;
  verifyAndParseWebhook(input: RawWebhook): Promise<ProviderEvent>;
}
```

Erros do provedor são traduzidos para códigos internos estáveis e classificados como recuperáveis ou permanentes.

## 13. API

```text
GET    /api/v1/billing/settings
PATCH  /api/v1/billing/settings
GET    /api/v1/invoices
POST   /api/v1/invoices
GET    /api/v1/invoices/:id
POST   /api/v1/invoices/:id/payments/manual
POST   /api/v1/invoices/:id/payments/pix
POST   /api/v1/payments/:id/refunds
GET    /api/v1/payments/:id/status
GET    /api/v1/reconciliation/items
POST   /api/v1/reconciliation/runs
POST   /api/v1/reconciliation/items/:id/resolve
GET    /api/v1/receipts/:id
POST   /api/v1/webhooks/payments/:provider
```

Webhooks usam corpo bruto quando exigido pela assinatura do provedor, limite de tamanho, rate limiting e resposta rápida após persistência segura.

## 14. Eventos

```text
InvoiceOpened
InvoiceOverdue
PaymentCreated
PaymentConfirmed
PaymentFailed
PaymentRefunded
SubscriptionPastDue
EntitlementSuspended
EntitlementActivated
ReconciliationMismatchDetected
```

## 15. Segurança e conformidade

- checkout e tokenização hospedados ou componentes seguros do provedor;
- PAN, CVV e trilha magnética nunca passam pelo backend;
- webhooks autenticados, protegidos contra replay e limitados por tamanho;
- payload bruto tem retenção mínima necessária e acesso restrito;
- refund e pagamento manual exigem step-up authentication conforme valor;
- dados financeiros exportados usam URL temporária e auditoria;
- mensagens públicas não revelam valor em aberto na catraca.

## 16. Requisitos não funcionais

- `M2-NFR-001`: p95 webhook persistido → entitlement atualizado menor que 30 s.
- `M2-NFR-002`: disponibilidade de processamento não depende da interface web.
- `M2-NFR-003`: reprocessamento de qualquer evento é seguro e idempotente.
- `M2-NFR-004`: valores e datas são consistentes sob concorrência.
- `M2-NFR-005`: fila financeira possui alertas de idade, volume e dead letters.
- `M2-NFR-006`: auditoria financeira é imutável para usuários do tenant.
- `M2-NFR-007`: relatórios e exportações não expõem dados de outro tenant.
- `M2-NFR-008`: indisponibilidade do provedor não degrada leitura de invoices já armazenadas.

## 17. Testes obrigatórios

- máquina de estados e política de vencimento em diferentes timezones;
- webhook válido, inválido, duplicado, atrasado e fora de ordem;
- concorrência entre webhook e consulta ativa;
- falha após persistir evento e antes de publicar outbox;
- centavos, descontos, cancelamento e refund;
- tenant isolation e autorização financeira;
- contrato contra sandbox do provedor;
- E2E: gerar PIX → confirmar → ativar entitlement → sincronizar Edge;
- E2E: vencer → carência → bloquear → pagar → desbloquear;
- carga de pico de webhooks com backlog e recuperação.

## 18. Critérios de aceite

- `M2-AC-001`: invoice é gerada uma vez para o período correto.
- `M2-AC-002`: PIX é exibido com valor, validade e identificação corretos.
- `M2-AC-003`: webhook inválido não altera estado e gera sinal operacional seguro.
- `M2-AC-004`: dez entregas do mesmo webhook geram uma confirmação lógica.
- `M2-AC-005`: evento atrasado não reabre pagamento concluído.
- `M2-AC-006`: pagamento confirmado ativa entitlement dentro do SLO.
- `M2-AC-007`: inadimplência suspende acesso somente após a carência.
- `M2-AC-008`: pagamento após bloqueio restaura acesso e atualiza Edge.
- `M2-AC-009`: refund segue política, preserva histórico e é conciliado.
- `M2-AC-010`: operador identifica e resolve divergência sem editar dados diretamente.
- `M2-AC-011`: nenhum teste ou log contém PAN, CVV, token real ou segredo de webhook.

## 19. Rollout

1. sandbox com relógio controlado;
2. homologação com valores mínimos e conta do cliente inaugural;
3. geração paralela sem bloquear acesso;
4. ativação para grupo piloto;
5. ativação de inadimplência somente após um ciclo conciliado;
6. expansão e monitoramento de SLO.

Feature flags independentes: `BILLING_PIX`, `BILLING_CARD`, `AUTOMATIC_DELINQUENCY_BLOCK` e `PAYMENT_REFUND`.

## 20. Checklist

- [ ] Gate de provedor aprovado
- [ ] Slice 2.1 — Ledger e invoice
- [ ] Slice 2.2 — PIX e webhook
- [ ] Slice 2.3 — Cartão e recorrência
- [ ] Slice 2.4 — Inadimplência e acesso
- [ ] Slice 2.5 — Estorno e conciliação
- [ ] ciclo financeiro piloto conciliado
- [ ] runbooks e alertas validados
