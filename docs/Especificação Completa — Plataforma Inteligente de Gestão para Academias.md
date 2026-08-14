# Especificação Completa — Plataforma Inteligente de Gestão para Academias

## 1. Visão do Produto

### 1.1 Objetivo

Desenvolver uma plataforma SaaS completa para gestão de academias, integrando:

- gestão administrativa;
- cadastro completo de alunos;
- reconhecimento facial;
- catracas eletrônicas Topdata;
- controle automático de acesso;
- planos e assinaturas;
- cobrança recorrente;
- pagamento por PIX e cartão;
- inadimplência;
- bioimpedância;
- frequência cardíaca;
- acompanhamento da evolução física;
- inteligência artificial;
- ranking;
- gamificação;
- aplicativo mobile;
- totem de autoatendimento;
- relatórios;
- inteligência de retenção de alunos.

O sistema deve atender tanto uma academia individual quanto redes com múltiplas unidades.

---

# 2. Proposta de Valor

A plataforma terá como princípio:

> Da matrícula ao resultado físico do aluno: pagamento, reconhecimento facial, acesso, frequência e evolução em uma única plataforma.

O diferencial não será apenas controlar uma catraca.

O produto será organizado em cinco pilares:

1. **Gym Management**
2. **Smart Billing**
3. **Smart Access**
4. **Health Intelligence**
5. **Engagement & Retention**

---

# 3. Arquitetura Geral

## 3.1 Arquitetura proposta

```text
                         CLOUD

                  ┌───────────────────┐
                  │      CDN / WAF    │
                  └─────────┬─────────┘
                            │
                    HTTPS / WebSocket
                            │
                 ┌──────────▼──────────┐
                 │     API GATEWAY     │
                 │       NestJS        │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
        PostgreSQL        Redis        Object
                                      Storage
              │
              │
         Queue / Jobs
           BullMQ
              │
      ┌───────┴────────┐
      │                │
 Notifications      Integrations


 ------------------------------------------------


                  ACADEMIA / LOCAL

             ┌─────────────────────┐
             │   GYM EDGE AGENT    │
             │                     │
             │ Topdata Adapter     │
             │ Local SQLite        │
             │ Cache de acesso     │
             │ Queue local         │
             └──────────┬──────────┘
                        │
             ┌──────────┴─────────┐
             │                    │
             ▼                    ▼
      Leitor Facial           Catraca
        Topdata               Topdata
```

---

# 4. Stack Tecnológica

## Backend Cloud

- Node.js
- TypeScript
- NestJS
- PostgreSQL
- Redis
- BullMQ
- WebSocket
- REST API
- OpenAPI / Swagger

## Administrativo Web

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- React Hook Form

## Mobile

- React Native
- Expo
- TypeScript

## Totem

Inicialmente:

- Next.js / React
- PWA
- modo kiosk

Posteriormente poderá existir um aplicativo nativo dedicado.

## Gateway Local

Nome sugerido:

```text
gym-edge-agent
```

Tecnologia:

- Node.js quando possível;
- serviço nativo complementar quando necessário para SDK/DLL Topdata;
- SQLite;
- WebSocket;
- HTTPS.

A compatibilidade exata do EasyInner com o ambiente do agente deve ser validada na prova de conceito. O SDK oficial possui exemplos inclusive em C#, Java e outras linguagens, e a integração da linha Inner é feita através da biblioteca EasyInner. 

---

# 5. Estratégia Arquitetural

## 5.1 Modular Monolith

A primeira versão será construída como:

```text
Modular Monolith
```

Em vez de microserviços.

Motivos:

- menor complexidade;
- deploy mais simples;
- menor custo;
- transações mais fáceis;
- desenvolvimento mais rápido;
- ótimo para MVP e fase inicial do SaaS.

Os domínios devem permanecer isolados para permitir extração futura em microserviços.

---

# 6. Multi-Tenant

A aplicação deve nascer multiempresa.

Estrutura:

```text
Tenant
  │
  ├── Academia
  │     ├── Unidade A
  │     ├── Unidade B
  │     └── Unidade C
```

Entidades de negócio devem possuir:

```text
tenant_id
```

Quando aplicável:

```text
gym_unit_id
```

O tenant representa a empresa contratante.

A unidade representa uma academia física.

---

# 7. Perfis do Sistema

Principais usuários:

### Super Admin

Administrador da plataforma SaaS.

### Proprietário da academia

Acesso total ao tenant.

### Gerente

Gerenciamento operacional.

### Financeiro

Cobranças, contratos e pagamentos.

### Recepcionista

Cadastro e atendimento.

### Avaliador físico

Bioimpedância e avaliações.

### Personal Trainer

Alunos e evolução física.

### Aluno

Aplicativo e portal.

### Operador técnico

Equipamentos, integrações e suporte.

---

# 8. RBAC

Sistema de autorização:

```text
User
 └── Role
      └── Permission
```

Exemplos:

```text
student.create
student.update
student.delete

payment.read
payment.refund

device.configure

assessment.create

access.override
```

---

# 9. Cadastro da Academia

Dados:

- razão social;
- nome fantasia;
- CNPJ;
- endereço;
- telefone;
- e-mail;
- responsável;
- timezone;
- logo;
- identidade visual;
- status;
- plano SaaS;
- unidades;
- configurações financeiras;
- configurações de acesso.

---

# 10. Cadastro da Unidade

Campos:

```text
id
tenant_id
name
code
address
phone
timezone
status
capacity
opening_hours
```

Também:

- feriados;
- horários especiais;
- dispositivos;
- recepção;
- responsáveis.

---

# 11. Cadastro Completo do Aluno

## Dados pessoais

- nome;
- CPF;
- RG;
- data de nascimento;
- sexo cadastral;
- telefone;
- WhatsApp;
- e-mail;
- foto;
- endereço;
- CEP;
- cidade;
- estado.

## Contato de emergência

- nome;
- parentesco;
- telefone.

## Informações administrativas

- matrícula;
- unidade;
- data de cadastro;
- origem do lead;
- consultor;
- status.

Status possíveis:

```text
LEAD
TRIAL
ACTIVE
SUSPENDED
BLOCKED
CANCELLED
ARCHIVED
```

---

# 12. Matrícula

Cada aluno deve possuir uma matrícula.

Exemplo:

```text
GYM-2026-00001284
```

A matrícula nunca deve depender do CPF.

---

# 13. Cadastro Facial

A identidade facial deve ser separada do cadastro convencional.

Entidade:

```text
BiometricIdentity
```

Campos:

```text
id
tenant_id
student_id
type
status
external_enroll_id
consent_status
consent_version
consented_at
revoked_at
created_at
updated_at
```

Tipos:

```text
FACE
FINGERPRINT
OTHER
```

---

# 14. Facial Topdata

O leitor facial Topdata utiliza comunicação WebSocket e disponibiliza comandos para gerenciamento de usuários, autenticação e troca de informações com o sistema.

O dispositivo utiliza um identificador próprio do usuário.

Mapeamento:

```text
Student.id
        ↓
DeviceUser
        ↓
Topdata enrollid
```

Exemplo:

```text
student_id:
e781f...

enrollid:
83714
```

CPF não deve ser utilizado como identificador técnico do dispositivo.

---

# 15. Cadastro Facial — Fluxo

```text
Recepção
   ↓
Cadastrar aluno
   ↓
Capturar foto
   ↓
Backend
   ↓
Criar BiometricIdentity
   ↓
Criar DeviceSyncJob
   ↓
Gym Edge Agent
   ↓
Topdata Facial
   ↓
Confirmação
```

Resultado:

```text
SYNCED
```

---

# 16. Sincronização de Usuários

Estados:

```text
PENDING
PROCESSING
SYNCED
FAILED
RETRYING
REMOVED
```

A Topdata informa que a API/protocolo facial não possui operação única para cadastrar, atualizar ou excluir uma lista inteira de usuários de uma vez; portanto, a nossa arquitetura deve possuir fila e controle de sincronização individual por usuário/dispositivo. 

Isso torna obrigatório um módulo robusto de sincronização.

---

# 17. Device User

Entidade:

```text
DeviceUser
```

Campos:

```text
id
device_id
student_id
external_user_id
sync_status
last_sync_at
last_error
retry_count
```

---

# 18. Controle de Acesso

O acesso não deve depender diretamente de pagamento.

A arquitetura deverá utilizar:

```text
ENTITLEMENT
```

ou direito de acesso.

Fluxo:

```text
Pagamento
    ↓
Assinatura
    ↓
Entitlement
    ↓
Access Engine
```

---

# 19. Entitlement

Exemplo:

```text
Student:
João

Entitlement:
GYM_ACCESS

Starts:
2026-08-01

Expires:
2027-08-01

Status:
ACTIVE
```

Isso permite:

- assinaturas;
- cortesia;
- funcionários;
- personal;
- visitante;
- aula experimental;
- dependentes;
- parceiros;
- planos corporativos.

---

# 20. Access Decision Engine

Responsável por decidir:

```text
ALLOW
DENY
```

Regras possíveis:

1. aluno existe;
2. aluno ativo;
3. biometria reconhecida;
4. entitlement ativo;
5. assinatura válida;
6. horário autorizado;
7. unidade permitida;
8. dia autorizado;
9. sem bloqueio administrativo;
10. sem restrição configurada;
11. número máximo de acessos;
12. antifraude;
13. período de carência;
14. acesso duplicado;
15. regra especial da unidade.

---

# 21. Resposta do Access Engine

```json
{
  "decision": "ALLOW",
  "studentId": "uuid",
  "reason": "ACTIVE_ENTITLEMENT",
  "validUntil": "2026-09-20T23:59:59"
}
```

Ou:

```json
{
  "decision": "DENY",
  "reason": "SUBSCRIPTION_OVERDUE"
}
```

---

# 22. Fluxo Facial + Catraca

Para uma catraca da linha Inner:

```text
Aluno
 ↓
Leitor facial
 ↓
Reconhecimento
 ↓
WebSocket
 ↓
Gym Edge Agent
 ↓
Access Decision
 ↓
EasyInner
 ↓
Liberação da catraca
```

A própria Topdata descreve esse modelo: o leitor facial identifica a pessoa, o software avalia a regra de negócio e ordena a liberação da catraca. 

---

# 23. Compatibilidade Topdata

A plataforma deve criar uma camada:

```text
AccessDeviceAdapter
```

Implementações:

```text
TopdataInnerAdapter
TopdataFacialAdapter
```

Futuramente:

```text
ControlIDAdapter
HenryAdapter
IntelbrasAdapter
GenericWiegandAdapter
```

Isso evita dependência estrutural de um único fabricante.

---

# 24. Gym Edge Agent

O agente local será o componente crítico da integração física.

Responsabilidades:

- comunicação Topdata;
- WebSocket facial;
- EasyInner;
- cache local;
- controle de conectividade;
- heartbeat;
- fila local;
- download de permissões;
- sincronização de eventos;
- buffer offline;
- logs;
- monitoramento.

---

# 25. Offline Mode

O sistema não pode parar se a internet cair.

O agente deverá possuir localmente:

```text
SQLite
```

Com cache de:

- alunos autorizados;
- entitlement;
- período de validade;
- regras essenciais;
- IDs biométricos;
- configuração do dispositivo.

---

# 26. Estratégia Offline

Online:

```text
Gateway → Cloud → Access Engine
```

Offline:

```text
Gateway → Local Access Cache
```

Quando a internet voltar:

```text
Local Events
     ↓
Synchronization
     ↓
Cloud
```

---

# 27. Política de Segurança Offline

Configuração por academia:

```text
offline_access_enabled
offline_cache_validity
offline_grace_period
```

Exemplo:

```text
Cache válido:
12 horas

Carência:
24 horas
```

---

# 28. Device Management

Entidade:

```text
Device
```

Campos:

```text
id
tenant_id
gym_unit_id
type
manufacturer
model
serial_number
ip_address
port
firmware
status
last_heartbeat
last_sync
configuration
```

Tipos:

```text
TURNSTILE
FACE_READER
TOTEM
CARD_READER
QR_READER
```

---

# 29. Monitoramento de Dispositivo

Dashboard:

```text
CATRACA 01
ONLINE

FACIAL 01
ONLINE

IP:
192.168.0.20

Último heartbeat:
5 segundos

Último acesso:
18:32

Pendências de sincronização:
2
```

---

# 30. Acesso Manual

Recepção poderá liberar manualmente a catraca.

Obrigatório registrar:

```text
operator_id
student_id
device_id
reason
timestamp
```

Exemplos:

```text
FACIAL_FAILURE
VISITOR
TECHNICAL_SUPPORT
MANAGER_OVERRIDE
```

---

# 31. Access Event

Entidade principal:

```text
AccessEvent
```

Campos:

```text
id
tenant_id
unit_id
student_id
device_id
timestamp
direction
method
decision
reason
offline
external_event_id
```

Direction:

```text
ENTRY
EXIT
```

Method:

```text
FACE
CARD
QR
PIN
MANUAL
```

Decision:

```text
GRANTED
DENIED
```

---

# 32. Planos

Entidade:

```text
Plan
```

Campos:

```text
id
tenant_id
name
description
billing_cycle
duration
price
currency
status
```

---

# 33. Ciclos

```text
MONTHLY
QUARTERLY
SEMIANNUAL
YEARLY
CUSTOM
```

---

# 34. Regras do Plano

Exemplos:

- unidades permitidas;
- dias;
- horários;
- limite semanal;
- aulas inclusas;
- convidados;
- pausa permitida;
- número de dias de pausa;
- fidelidade;
- multa;
- acesso multiunidade.

---

# 35. Assinatura

Entidade:

```text
Subscription
```

Campos:

```text
id
student_id
plan_id
status
started_at
current_period_start
current_period_end
next_billing_date
cancelled_at
paused_at
provider
```

Status:

```text
PENDING
ACTIVE
PAST_DUE
PAUSED
CANCELLED
EXPIRED
```

---

# 36. Financeiro

Módulos:

- cobrança;
- invoice;
- pagamento;
- recorrência;
- inadimplência;
- estorno;
- desconto;
- cupom;
- bolsa;
- cortesia;
- negociação.

---

# 37. Invoice

Campos:

```text
id
subscription_id
amount
due_date
status
paid_at
payment_method
```

Status:

```text
OPEN
PAID
OVERDUE
CANCELLED
REFUNDED
```

---

# 38. Payment Provider

Criar interface abstrata:

```text
PaymentProvider
```

Métodos:

```text
createPix()
createCardPayment()
createSubscription()
cancelSubscription()
refundPayment()
getPaymentStatus()
handleWebhook()
```

---

# 39. Gateways de Pagamento

Arquitetura preparada para múltiplos fornecedores.

Exemplos:

- Mercado Pago;
- Asaas;
- Pagar.me;
- Stripe;
- outros.

A escolha definitiva deve considerar taxas, PIX, recorrência, split, antecipação e suporte a SaaS.

---

# 40. Webhooks Financeiros

Exemplos:

```text
PAYMENT_CREATED
PAYMENT_CONFIRMED
PAYMENT_FAILED
PAYMENT_OVERDUE
PAYMENT_REFUNDED
SUBSCRIPTION_CANCELLED
```

---

# 41. Liberação Automática

Fluxo:

```text
PIX pago
 ↓
Webhook
 ↓
Payment = PAID
 ↓
Invoice = PAID
 ↓
Subscription = ACTIVE
 ↓
Entitlement = ACTIVE
 ↓
Gateway recebe atualização
 ↓
Aluno liberado
```

---

# 42. Inadimplência

Configuração:

```text
due_date
grace_period
blocking_policy
```

Exemplo:

```text
Vencimento:
10/08

Carência:
3 dias

Bloqueio:
14/08
```

---

# 43. Desbloqueio Imediato

Após compensação:

```text
PaymentConfirmed
```

gerar evento:

```text
EntitlementActivated
```

e sincronizar imediatamente com os agentes locais.

---

# 44. Totem de Autoatendimento

O totem terá:

### Identificação

- facial;
- CPF;
- QR Code;
- login.

### Funcionalidades

- situação da assinatura;
- pagamento;
- PIX;
- cartão;
- renovação;
- upgrade;
- downgrade;
- bioimpedância;
- histórico;
- evolução;
- frequência;
- ranking;
- metas;
- recibos.

---

# 45. Totem — Fluxo de Pagamento PIX

```text
Aluno
 ↓
Facial
 ↓
Mensalidade pendente
 ↓
Pagar agora
 ↓
Gerar QR PIX
 ↓
Pagamento
 ↓
Webhook
 ↓
Plano ativo
 ↓
Liberar catraca
```

---

# 46. Mobile do Aluno

Módulos:

### Home

- saudação;
- status do plano;
- próxima cobrança;
- frequência;
- evolução;
- atalhos.

### Carteirinha

- foto;
- matrícula;
- plano;
- unidade;
- QR Code.

### Plano

- plano atual;
- validade;
- upgrade;
- renovação;
- cancelamento;
- pausa.

### Financeiro

- cobranças;
- PIX;
- cartão;
- histórico;
- recibos.

### Frequência

- semana;
- mês;
- ano;
- streak.

### Avaliações

- bioimpedância;
- evolução;
- histórico.

### IA

- resumo;
- tendências;
- comparativos;
- metas.

### Ranking

- mensal;
- trimestral;
- semestral;
- anual.

---

# 47. Bioimpedância

Entidade:

```text
BodyAssessment
```

Campos principais:

```text
id
student_id
assessment_date
weight
height
bmi
body_fat_percentage
body_fat_mass
lean_mass
skeletal_muscle_mass
body_water_percentage
visceral_fat
basal_metabolic_rate
metabolic_age
waist_hip_ratio
```

---

# 48. Medidas Segmentares

Quando disponíveis:

```text
left_arm
right_arm
left_leg
right_leg
trunk
```

Para:

- massa muscular;
- gordura;
- água;
- impedância.

---

# 49. Origem da Bioimpedância

```text
MANUAL
DEVICE
IMPORT
IMAGE_AI
API
```

---

# 50. Upload de Laudo

Permitir:

- PDF;
- imagem;
- fotografia;
- CSV;
- integração direta futura.

Pipeline:

```text
Upload
 ↓
Extração
 ↓
Validação
 ↓
Operador confirma
 ↓
BodyAssessment
```

A IA não deve inserir silenciosamente valores sem validação quando o dado vier de OCR ou imagem.

---

# 51. Histórico Comparativo

Comparar:

```text
Atual
vs.
Anterior
vs.
Primeira avaliação
vs.
Meta
```

Exemplo:

```text
Peso

Inicial: 94kg
Anterior: 89kg
Atual: 86kg

Resultado:
-8kg
```

---

# 52. Gráficos

Indicadores:

- peso;
- percentual de gordura;
- massa de gordura;
- massa muscular;
- massa magra;
- gordura visceral;
- água;
- IMC;
- metabolismo basal.

Períodos:

```text
30D
90D
6M
1A
ALL
```

---

# 53. Frequência Cardíaca

Entidade:

```text
HealthMeasurement
```

Campos:

```text
student_id
measurement_type
value
unit
measured_at
source
device
```

Tipos:

```text
HEART_RATE
RESTING_HEART_RATE
BLOOD_PRESSURE
OXYGEN_SATURATION
```

A expansão para outras métricas deve permanecer opcional.

---

# 54. AI Health Analysis

O sistema de IA receberá:

- histórico de bioimpedância;
- frequência de treino;
- metas;
- idade;
- medidas;
- tendências.

Saídas:

```text
summary
progress
positive_points
attention_points
trend
goal_progress
questions_for_professional
```

---

# 55. Limites da IA

A IA deverá ser apresentada como:

```text
análise de acompanhamento
```

e não diagnóstico médico.

Nunca deverá afirmar diretamente:

```text
Você possui doença X.
```

Mensagens devem incluir contexto apropriado quando aplicável.

---

# 56. AI Analysis

Entidade:

```text
AIAnalysis
```

Campos:

```text
id
student_id
type
source_period
model
prompt_version
input_snapshot
output
created_at
```

Isso permite auditoria e reprodutibilidade.

---

# 57. Ranking

Categorias possíveis:

### Evolução física

- maior redução percentual de gordura;
- maior ganho percentual de massa muscular;
- maior evolução composta.

### Frequência

- maior número de treinos;
- maior consistência;
- maior streak.

### Metas

- maior percentual de metas concluídas.

---

# 58. Ranking por Período

```text
MONTHLY
QUARTERLY
SEMIANNUAL
YEARLY
```

---

# 59. Privacidade do Ranking

Participação:

```text
OPT-IN
```

O aluno escolhe:

- participar;
- nome completo;
- primeiro nome;
- apelido;
- ocultar resultado absoluto.

---

# 60. Evitar Ranking Inadequado

Não criar simplesmente:

```text
Quem perdeu mais peso
```

como ranking principal.

Preferir métricas relativas e orientadas a evolução.

---

# 61. Gamificação

Entidade:

```text
Achievement
```

Exemplos:

```text
FIRST_WORKOUT
10_WORKOUTS
20_WORKOUTS_MONTH
30_DAY_STREAK
GOAL_REACHED
BODY_FAT_IMPROVEMENT
MUSCLE_GAIN
```

---

# 62. XP

Eventos podem gerar XP.

Exemplo:

```text
Treino:
+10 XP

Avaliação:
+20 XP

Meta concluída:
+100 XP
```

---

# 63. Streak

Exemplo:

```text
🔥 6 semanas consecutivas treinando
```

Evitar modelo que premie treino excessivo diário.

---

# 64. Dashboard Executivo

KPIs:

```text
Alunos ativos
Novos alunos
Cancelamentos
MRR
Receita
Inadimplência
Churn
Ticket médio
LTV
```

---

# 65. Dashboard Operacional

Indicadores:

```text
Acessos hoje
Acessos agora
Horário de pico
Acessos negados
Catracas online
Dispositivos offline
Falhas de sincronização
```

---

# 66. Dashboard de Retenção

Indicadores:

- frequência caiu;
- alunos ausentes;
- risco de churn;
- mensalidades atrasadas;
- tempo sem avaliação;
- redução de engajamento.

---

# 67. Churn Prediction

Módulo futuro:

```text
Retention Intelligence
```

Variáveis:

- frequência histórica;
- queda recente de visitas;
- inadimplência;
- tempo desde última avaliação;
- tempo desde matrícula;
- comportamento mensal;
- plano;
- histórico de pausas.

Exemplo:

```text
Aluno:
Carlos

Risco:
78%

Motivos:
frequência -54%
18 dias sem treino
1 cobrança vencida
```

---

# 68. CRM de Retenção

Ação:

```text
Criar tarefa para recepção
```

Exemplo:

```text
Entrar em contato com Carlos
```

Motivo:

```text
Alto risco de cancelamento
```

---

# 69. Notificações

Canais:

- push;
- WhatsApp;
- e-mail;
- SMS opcional;
- notificações internas.

---

# 70. Eventos de Notificação

Exemplos:

```text
Pagamento próximo
Pagamento vencido
Pagamento aprovado
Plano renovado
Plano vencendo
Meta atingida
Nova avaliação
Ranking atualizado
Aluno ausente
```

---

# 71. Event Bus Interno

Eventos:

```text
StudentCreated
StudentUpdated

SubscriptionCreated
SubscriptionActivated
SubscriptionExpired

PaymentConfirmed

EntitlementActivated
EntitlementRevoked

AccessGranted
AccessDenied

AssessmentCreated

DeviceOffline
DeviceOnline
```

---

# 72. Auditoria

Entidade:

```text
AuditLog
```

Registrar:

```text
user
action
entity
entity_id
before
after
ip
device
timestamp
```

---

# 73. Ações Auditáveis

Principalmente:

- alteração de aluno;
- exclusão;
- cancelamento;
- desconto;
- pagamento manual;
- estorno;
- liberação manual;
- alteração de avaliação;
- cadastro biométrico;
- exclusão de biometria.

---

# 74. LGPD

A plataforma tratará:

- dados pessoais;
- biometria;
- dados financeiros;
- dados relacionados à saúde.

Por isso deverá possuir:

- consentimento;
- finalidade;
- minimização;
- controle de acesso;
- retenção;
- trilha de auditoria;
- criptografia;
- exportação;
- anonimização;
- exclusão quando aplicável.

---

# 75. Consentimentos

Entidade:

```text
Consent
```

Campos:

```text
student_id
type
document_version
accepted_at
revoked_at
ip
device
```

Tipos:

```text
TERMS
PRIVACY
BIOMETRIC
HEALTH_DATA
MARKETING
RANKING
```

---

# 76. Exclusão de Biometria

Quando necessário:

```text
Revogar consentimento
 ↓
Desativar BiometricIdentity
 ↓
Criar DeviceSync DELETE
 ↓
Remover dos leitores
 ↓
Registrar auditoria
```

---

# 77. Segurança

Backend:

- JWT/OAuth;
- refresh token;
- MFA para administradores;
- rate limiting;
- RBAC;
- criptografia em trânsito;
- segredo em secret manager;
- logs de segurança.

---

# 78. Criptografia

Em trânsito:

```text
TLS
```

Em repouso:

- banco criptografado;
- backups criptografados;
- object storage privado.

Dados biométricos devem receber tratamento reforçado.

---

# 79. Observabilidade

Tecnologias possíveis:

- OpenTelemetry;
- Sentry;
- Grafana;
- Loki;
- Prometheus.

---

# 80. Métricas

Exemplos:

```text
api_latency
payment_webhook_errors
device_offline_count
access_decision_latency
sync_pending
sync_failed
gateway_last_seen
```

---

# 81. Alertas

Exemplo:

```text
Catraca offline há 5 minutos
```

ou:

```text
Gateway Academia Centro offline
```

---

# 82. Logs do Gateway

Registrar:

- conexão;
- desconexão;
- reconhecimento;
- decisão;
- comando;
- resposta;
- sync;
- erro.

---

# 83. Resiliência

Utilizar:

- retries;
- exponential backoff;
- idempotência;
- circuit breaker onde necessário;
- dead letter queue.

---

# 84. Idempotência

Muito importante para pagamentos.

Exemplo:

```text
payment webhook
```

pode chegar mais de uma vez.

O sistema deve processar somente uma alteração lógica.

---

# 85. API

Base:

```text
/api/v1
```

Exemplos:

```text
POST /students
GET /students/:id

POST /students/:id/biometric

POST /subscriptions
POST /payments/pix

GET /assessments

POST /devices

GET /access-events
```

---

# 86. Mobile API

Endpoints específicos podem utilizar BFF no futuro.

Inicialmente:

```text
/api/v1/mobile/*
```

---

# 87. Totem API

```text
/api/v1/kiosk/*
```

Com permissões extremamente restritas.

---

# 88. Gateway API

```text
/api/v1/edge/*
```

Autenticação por dispositivo.

---

# 89. Autenticação do Edge Agent

Cada gateway possuirá:

```text
device_id
certificate/secret
```

O gateway nunca utilizará credenciais comuns de usuário.

---

# 90. Banco de Dados — Entidades Principais

```text
tenants

gym_units

users
roles
permissions
user_roles

students
student_addresses
student_contacts

consents
biometric_identities

plans
subscriptions
entitlements

invoices
payments
payment_transactions

devices
device_users
device_sync_jobs

access_rules
access_events

body_assessments
body_measurements
health_measurements

ai_analyses

rankings
ranking_entries

achievements
student_achievements

notifications

audit_logs
```

---

# 91. Storage

Object Storage:

- foto de perfil;
- documentos;
- laudos;
- avaliações;
- arquivos importados.

Biometria deve seguir política específica.

---

# 92. Backups

PostgreSQL:

- backup diário;
- PITR;
- retenção configurável.

SQLite Gateway:

- banco operacional temporário;
- Cloud continua sendo source of truth.

---

# 93. Fluxo de Matrícula

```text
Recepção
 ↓
Cadastrar aluno
 ↓
Escolher plano
 ↓
Contrato
 ↓
Consentimentos
 ↓
Pagamento
 ↓
Cadastro facial
 ↓
Entitlement ativo
 ↓
Aluno liberado
```

---

# 94. Fluxo de Renovação

```text
Subscription
 ↓
Invoice
 ↓
Pagamento
 ↓
Webhook
 ↓
Nova validade
 ↓
Entitlement renovado
```

---

# 95. Fluxo de Inadimplência

```text
Invoice overdue
 ↓
Grace period
 ↓
Subscription PAST_DUE
 ↓
Entitlement revoked
 ↓
Gateway sync
 ↓
Acesso bloqueado
```

---

# 96. Fluxo de Desbloqueio

```text
Aluno paga PIX no totem
 ↓
Webhook
 ↓
Invoice PAID
 ↓
Subscription ACTIVE
 ↓
Entitlement ACTIVE
 ↓
Gateway recebe evento
 ↓
Acesso liberado
```

---

# 97. Fluxo de Bioimpedância

```text
Aluno
 ↓
Avaliação
 ↓
Dados importados
 ↓
Validação
 ↓
Salvar
 ↓
Comparar histórico
 ↓
Gerar IA
 ↓
Atualizar ranking
```

---

# 98. Fluxo de Acesso

```text
Rosto
 ↓
Leitor Topdata
 ↓
Gateway
 ↓
Identify student
 ↓
Access Engine
 ↓
ALLOW / DENY
 ↓
Catraca
 ↓
AccessEvent
 ↓
Cloud
```

---

# 99. SLA do Controle de Acesso

Objetivo:

```text
decisão local:
< 300 ms
```

Não é requisito rígido inicial, mas deve orientar a arquitetura.

A sensação precisa ser imediata.

---

# 100. Administração SaaS

Super Admin terá:

- tenants;
- assinaturas SaaS;
- usuários;
- uso;
- dispositivos;
- suporte;
- logs;
- billing;
- feature flags.

---

# 101. Feature Flags

Exemplo:

```text
AI_ANALYSIS
RANKING
TOTEM
WHATSAPP
MULTI_UNIT
CHURN_AI
```

---

# 102. Plano Comercial SaaS

Exemplo futuro:

### Starter

- 1 unidade;
- até X alunos;
- acesso;
- financeiro.

### Pro

- IA;
- bioimpedância;
- mobile;
- ranking.

### Enterprise

- multiunidade;
- API;
- BI;
- SLA;
- integrações.

---

# 103. MVP 0 — Prova Técnica Topdata

Antes do produto, fazer laboratório.

Objetivos:

- conectar leitor;
- receber reconhecimento;
- cadastrar usuário;
- excluir usuário;
- identificar usuário;
- liberar catraca;
- detectar giro;
- simular offline;
- reconectar;
- medir latência.

Esse MVP elimina o principal risco técnico.

---

# 104. MVP 1 — Smart Access

Inclui:

- tenant;
- unidade;
- usuários;
- alunos;
- planos;
- assinatura manual;
- entitlement;
- cadastro facial;
- Topdata;
- Gym Edge Agent;
- controle da catraca;
- access engine;
- access events;
- dashboard operacional;
- logs;
- offline.

Resultado:

> academia operando fisicamente pelo sistema.

---

# 105. MVP 2 — Billing

Inclui:

- invoices;
- PIX;
- cartão;
- recorrência;
- webhook;
- inadimplência;
- carência;
- bloqueio automático;
- desbloqueio;
- recibos.

Resultado:

> pagamento controla automaticamente direito de acesso.

---

# 106. MVP 3 — Health Intelligence

Inclui:

- bioimpedância;
- histórico;
- comparativos;
- gráficos;
- frequência;
- coração;
- análise IA;
- metas.

Resultado:

> academia acompanha evolução real do aluno.

---

# 107. MVP 4 — App + Totem

Inclui:

- mobile;
- carteirinha;
- pagamentos;
- frequência;
- avaliação;
- totem;
- PIX;
- autoatendimento.

---

# 108. MVP 5 — Engagement

Inclui:

- ranking;
- gamificação;
- XP;
- streak;
- metas;
- notificações;
- desafios.

---

# 109. MVP 6 — Retention AI

Inclui:

- churn prediction;
- alunos em risco;
- CRM de retenção;
- alertas;
- automação;
- campanhas.

---

# 110. Roadmap Técnico Resumido

```text
FASE 0
Integração Topdata

↓

FASE 1
Gestão + Catraca

↓

FASE 2
Financeiro

↓

FASE 3
Bioimpedância + IA

↓

FASE 4
Mobile + Totem

↓

FASE 5
Engajamento

↓

FASE 6
Retention AI
```

---

# 111. Principais Riscos Técnicos

## Risco 1 — Hardware

Modelos Topdata diferentes podem exigir comportamentos distintos.

Mitigação:

```text
Device Adapter
```

---

## Risco 2 — Dependência de DLL

EasyInner utiliza SDK/biblioteca específica.

Mitigação:

```text
Gateway isolado
```

---

## Risco 3 — Internet

Mitigação:

```text
offline-first gateway
```

---

## Risco 4 — Dados faciais

Mitigação:

- consentimento;
- segurança;
- retenção;
- auditoria;
- exclusão sincronizada.

---

## Risco 5 — Pagamento duplicado

Mitigação:

```text
idempotency
```

---

## Risco 6 — Sincronização facial

O protocolo facial trabalha com operações por usuário.

Mitigação:

```text
DeviceSyncQueue
```

---

# 112. Requisitos Não Funcionais

## Disponibilidade

Cloud:

```text
99,9%
```

Objetivo futuro.

## Escalabilidade

Arquitetura preparada para:

```text
milhares de academias
milhões de access events
```

## Performance

APIs normais:

```text
p95 < 500ms
```

Acesso local:

```text
preferencialmente < 300ms
```

---

# 113. Privacidade por Design

Sempre aplicar:

```text
minimum required data
```

Evitar armazenar dados desnecessários.

---

# 114. UX do Acesso

Mensagens simples.

Liberado:

```text
Olá, João!
Bom treino 💪
```

Bloqueado:

```text
Plano pendente.
Procure a recepção.
```

Evitar mostrar:

```text
Você deve R$ 249,90.
```

na tela pública da catraca.

---

# 115. Fallback de Acesso

Métodos:

1. facial;
2. QR;
3. cartão;
4. PIN;
5. liberação pela recepção.

---

# 116. Web Administrativo — Menu

```text
Dashboard

Alunos
 ├ Cadastro
 ├ Matrículas
 ├ Frequência
 ├ Avaliações
 └ Histórico

Comercial
 ├ Leads
 ├ Planos
 └ Contratos

Financeiro
 ├ Cobranças
 ├ Recebimentos
 ├ Inadimplência
 └ Relatórios

Acesso
 ├ Catracas
 ├ Faciais
 ├ Eventos
 ├ Bloqueios
 └ Dispositivos

Saúde
 ├ Bioimpedância
 ├ Evolução
 ├ IA
 └ Metas

Engajamento
 ├ Ranking
 ├ Desafios
 └ Conquistas

Relatórios

Configurações
```

---

# 117. Dashboard Principal

Cards:

```text
Alunos ativos

Receita mensal

Inadimplência

Novos alunos

Cancelamentos

Acessos hoje

Dispositivos

Risco de churn
```

---

# 118. Relatórios

### Financeiro

- MRR;
- receita;
- ticket médio;
- inadimplência;
- recebimentos.

### Alunos

- ativos;
- novos;
- cancelamentos;
- retenção.

### Acesso

- entradas;
- horários;
- picos;
- recusas.

### Saúde

- avaliações;
- evolução média;
- metas.

---

# 119. Analytics

Eventos de produto:

```text
student_created
payment_completed
subscription_created
access_granted
assessment_created
ranking_viewed
```

---

# 120. API Pública Futura

Parceiros poderão:

```text
GET students
GET access
POST assessments
GET subscriptions
```

Utilizando:

```text
OAuth2/API Key
```

---

# 121. Integração com ERP

Futura:

```text
AccountingAdapter
```

Para:

- notas;
- financeiro;
- contabilidade.

---

# 122. WhatsApp

Futuro:

```text
WhatsApp Business API
```

Casos:

- cobrança;
- renovação;
- aluno ausente;
- avaliação disponível;
- conquista.

---

# 123. Evolução Arquitetural

Somente quando necessário:

```text
Billing Service
Access Service
Notification Service
AI Service
```

podem ser extraídos do monólito.

Não começar com isso.

---

# 124. Estrutura de Módulos NestJS

```text
src/

modules/

  auth/
  tenants/
  units/

  users/
  students/

  plans/
  subscriptions/
  entitlements/

  billing/
  payments/

  devices/
  access/
  edge/

  biometrics/

  assessments/
  health/

  ai/

  rankings/
  achievements/

  notifications/

  audit/
```

---

# 125. Separação de Responsabilidades

Cloud:

```text
source of truth
```

Gateway:

```text
hardware integration
offline execution
```

Facial:

```text
identity
```

Catraca:

```text
physical passage
```

Pagamento:

```text
financial event
```

Entitlement:

```text
access right
```

Essa separação é um dos princípios mais importantes do projeto.

---

# 126. Produto Final

O sistema deve evoluir de:

```text
Sistema de academia
```

para:

```text
Gym Operating System
```

capaz de administrar:

```text
ALUNO
+
PAGAMENTO
+
ACESSO
+
TREINO
+
FREQUÊNCIA
+
SAÚDE
+
ENGAJAMENTO
+
RETENÇÃO
```

---

# 127. Prioridade de Desenvolvimento

Ordem recomendada:

```text
1. POC Topdata
2. Edge Agent
3. Access Engine
4. Alunos
5. Planos
6. Assinaturas
7. Controle de acesso
8. Financeiro
9. Bioimpedância
10. IA
11. Totem
12. Mobile
13. Ranking
14. Retention AI
```

---

# 128. Critério de Sucesso do Primeiro Produto

O primeiro marco real é:

> Um aluno é cadastrado no sistema, recebe seu plano e reconhecimento facial, aproxima-se da catraca, é reconhecido e entra automaticamente somente se possuir um entitlement válido.

O segundo marco é:

> O aluno inadimplente paga via PIX no próprio celular ou totem e, após a confirmação do webhook, tem seu acesso restaurado automaticamente.

O terceiro marco é:

> A academia consegue relacionar frequência, pagamentos e evolução corporal do aluno em uma única timeline.

Quando esses três marcos estiverem funcionando, a plataforma já terá uma base muito forte para se tornar um produto SaaS comercial.