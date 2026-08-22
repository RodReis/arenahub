# PRD técnico — MVP 4: App do aluno e Totem

## 1. Controle

- Status: APROVADO para planejamento em 14/08/2026
- Dependências: APIs estáveis dos MVPs 1, 2 e 3
- Resultado: aluno consulta dados e resolve jornadas essenciais sem depender da recepção
- Canais: aplicativo Expo/React Native e totem Next.js PWA em modo kiosk
- Contrato transversal: [estrutura, comandos, testes e limites](../README.md)

## 2. Objetivo

Entregar autosserviço seguro para situação cadastral, carteirinha, frequência, avaliações e pagamentos. O app é um canal autenticado pessoal; o totem é um dispositivo público de alto risco e usa sessões efêmeras, escopo mínimo e limpeza automática.

## 3. Métricas de sucesso

- ao menos 70% dos alunos piloto concluem login sem suporte;
- ao menos 80% das consultas de situação e segunda via piloto não exigem recepção;
- nenhuma sessão ou dado do aluno anterior permanece visível no totem;
- p95 de abertura da Home após autenticação menor que 2,5 s em conexão móvel de referência;
- pagamento iniciado no app/totem usa o mesmo fluxo idempotente do MVP 2;
- crashes e falhas de jornada possuem telemetria sem PII indevida.

## 4. Personas

- Aluno: acessa exclusivamente os próprios dados e ações autorizadas.
- Responsável/dependente: fora do escopo inicial, mas sem impedir modelagem futura.
- Recepcionista: auxilia ativação, sem conhecer senha ou assumir sessão do aluno.
- Operador técnico: provisiona e monitora totem sem acessar dados exibidos.

## 5. Gates de entrada

- [ ] OpenAPI dos MVPs anteriores versionada e estável;
- [ ] política de identidade e recuperação de conta aprovada;
- [ ] threat model do app e do kiosk aprovado;
- [ ] dispositivos, navegador, impressora e leitor do totem inventariados;
- [ ] estratégia de push e deep links definida antes de implementá-los;
- [ ] política de publicação nas lojas decidida antes do rollout público;
- [ ] conteúdo de privacidade, termos e suporte aprovado.


> **Emenda de 22/08/2026 — ADR-042.** As Slices **4.5** e **4.6** passam a ser **executadas no
> MVP 3.5**, que antecipa o totem para antes do app mobile. O texto, os requisitos e o aceite
> delas **continuam sendo os desta seção** — o ADR-042 as cita, não as copia. Consequência para
> os gates acima: os itens de *threat model do kiosk* e de *inventário de dispositivos do totem*
> passam a ser gate do **MVP 3.5**; os demais continuam sendo gate do MVP 4. Materializa decisão
> do PI de 22/08/2026 registrada em [ADR-042](../../DECISIONS.md#adr-042).

## 6. Escopo

### App incluído

- ativação de conta e login;
- recuperação segura;
- Home com status do plano, próxima cobrança e frequência;
- carteirinha digital e QR rotativo quando habilitado;
- plano e assinatura;
- invoices, PIX, cartão tokenizado e recibos;
- frequência e avaliações;
- análise de IA já produzida no MVP 3;
- perfil, consentimentos e sessões;
- notificações push essenciais quando o gate do provedor for atendido antes da Slice 4.7.

### Totem incluído

- provisionamento por dispositivo;
- identificação por QR rotativo ou credencial efêmera; CPF exige segundo fator;
- situação do plano e invoices;
- geração de PIX e pagamento tokenizado hospedado;
- consulta resumida de frequência e avaliação;
- encerramento automático e limpeza de sessão;
- acessibilidade e modo degradado seguro;
- telemetria e atualização controlada.

### Fora de escopo

- chat com personal;
- rede social;
- treino prescrito;
- dependentes e conta familiar;
- dados offline persistentes no app;
- biometria facial do próprio celular como identidade do aluno no backend;
- armazenamento de cartão pelo ArenaHub;
- atendimento por vídeo;
- ranking e gamificação, tratados no MVP 5.

Se o gate de push não estiver atendido, a capacidade é formalmente transferida para a Slice 5.5 e não bloqueia a saída do MVP 4. Notificações internas no app continuam obrigatórias.

## 7. Slices verticais


> **Emenda de 22/08/2026 — ADR-042.** As Slices **4.5 — Kiosk seguro** e **4.6 — Pagamento e
> desbloqueio no totem** são executadas como **F49 (Slice 3.5.1)** e **F52 (Slice 3.5.4)** do
> MVP 3.5. Elas ganham uma exigência que não estava escrita aqui: pela Decisão 0 do ADR-042,
> **nenhuma tela do `kiosk` nasce com valor fixo** naquilo que a Decisão 6 do mesmo ADR não
> trava — marca, cor, tempo de sessão, blocos e módulos são lidos de `KioskConfig` desde o
> primeiro commit. Materializa decisão do PI de 22/08/2026 registrada em
> [ADR-042](../../DECISIONS.md#adr-042).

### Slice 4.1 — Identidade e shell mobile

- app Expo com navegação, tema e acessibilidade;
- ativação por convite/código de uso único;
- login, refresh, logout e recuperação;
- armazenamento seguro de tokens;
- Home mínima e observabilidade.

Aceite: aluno ativa conta e retorna ao app sem nova senha enquanto a sessão for válida e não revogada.

### Slice 4.2 — Carteirinha, plano e frequência

- carteirinha com matrícula e QR rotativo;
- status do plano e validade;
- frequência por períodos;
- estados vazios, indisponibilidade e dados desatualizados.

Aceite: aluno consulta dados próprios e QR expirado não é aceito.

### Slice 4.3 — Financeiro mobile

- lista e detalhe de invoices;
- PIX, checkout tokenizado e retorno verificado no backend;
- atualização de status por polling controlado/push;
- recibos e histórico.

Aceite: fechar ou reabrir o app não duplica cobrança nem confirmação.

### Slice 4.4 — Avaliações e consentimentos

- histórico e gráficos acessíveis;
- análise assistiva e aviso;
- gestão de consentimentos permitidos;
- exportação solicitada de forma assíncrona.

Aceite: aluno acessa somente seu histórico publicado e entende a origem dos dados.

### Slice 4.5 — Kiosk seguro

- provisionamento com identidade de dispositivo;
- sessão efêmera e escopo `/api/v1/kiosk`;
- identificação segura;
- plano, invoices e PIX;
- timeout, limpeza de cache e retorno à tela inicial;
- remote health e atualização.

Aceite: uma bateria automatizada e manual comprova que dados do usuário A não aparecem para o usuário B.

### Slice 4.6 — Pagamento e desbloqueio no totem

- jornada pendência → pagamento → confirmação → entitlement;
- mensagens privadas e discretas;
- fallback para QR PIX no celular;
- acompanhamento sem manter sessão além do necessário.

Aceite: aluno paga e tem entitlement restaurado pelo fluxo do MVP 2, sem bypass local.

### Slice 4.7 — Piloto e distribuição

- builds assinados e canais internos;
- monitoramento de crash e jornada;
- política de versão mínima;
- runbooks de totem;
- publicação gradual e suporte.

Aceite: piloto atende métricas e possui rollback de app/API e restauração do totem.

## 8. Requisitos funcionais

### Identidade

- `M4-FR-001`: ativar conta por token de uso único, com validade e vínculo ao aluno.
- `M4-FR-002`: autenticar sem revelar se telefone/e-mail inexistente está cadastrado.
- `M4-FR-003`: armazenar tokens mobile somente no armazenamento seguro do sistema.
- `M4-FR-004`: listar e revogar sessões ativas.
- `M4-FR-005`: exigir nova autenticação para ações sensíveis.

### App

- `M4-FR-006`: exibir status da assinatura e data relevante sem inferir estado no cliente.
- `M4-FR-007`: emitir QR assinado, rotativo, curto e não reutilizável além da janela.
- `M4-FR-008`: exibir frequência derivada pelo backend.
- `M4-FR-009`: listar invoices e pagamentos próprios.
- `M4-FR-010`: iniciar PIX e cartão tokenizado por endpoints do MVP 2.
- `M4-FR-011`: acompanhar confirmação sem confiar no retorno do navegador.
- `M4-FR-012`: exibir avaliações publicadas, comparativos e análise já validada.
- `M4-FR-013`: solicitar exportação LGPD e receber link temporário.
- `M4-FR-014`: receber push apenas com consentimento e conteúdo mínimo na tela bloqueada.

### Totem

- `M4-FR-015`: provisionar totem para um tenant e unidade específicos.
- `M4-FR-016`: identificar aluno por método aprovado sem usar apenas CPF como autenticação.
- `M4-FR-017`: criar sessão curta, limitada ao aluno e dispositivo.
- `M4-FR-018`: expor apenas endpoints e campos necessários à jornada kiosk.
- `M4-FR-019`: encerrar sessão por ação, timeout, erro ou perda de foco configurada.
- `M4-FR-020`: limpar estado em memória, storage, cache visual e impressão temporária.
- `M4-FR-021`: gerar pagamento pelo backend sem armazenar método completo.
- `M4-FR-022`: expor health, versão e conectividade ao operador técnico.

## 9. Regras de negócio

- `M4-BR-001`: retorno visual do checkout nunca confirma pagamento; o backend confirma.
- `M4-BR-002`: QR da carteirinha expira rapidamente e contém token opaco, não PII.
- `M4-BR-003`: screenshot do QR pode funcionar apenas dentro da janela curta; replay posterior falha.
- `M4-BR-004`: CPF no totem é localizador, não autenticador suficiente.
- `M4-BR-005`: sessão kiosk expira após inatividade e sempre antes de sessão mobile comum.
- `M4-BR-006`: totem não persiste PII em storage durável ou autofill.
- `M4-BR-007`: tela pública usa descrição discreta de pendência, sem valor quando a privacidade exigir.
- `M4-BR-008`: app não recalcula estado financeiro, acesso ou saúde; renderiza decisão do backend.
- `M4-BR-009`: consentimento revogado interrompe novas notificações/processamentos correspondentes.

## 10. APIs específicas

```text
POST   /api/v1/mobile/activation/confirm
POST   /api/v1/mobile/auth/login
POST   /api/v1/mobile/auth/refresh
GET    /api/v1/mobile/home
GET    /api/v1/mobile/membership-card
POST   /api/v1/mobile/membership-card/qr
GET    /api/v1/mobile/invoices
POST   /api/v1/mobile/invoices/:id/pix
GET    /api/v1/mobile/attendance
GET    /api/v1/mobile/assessments
GET    /api/v1/mobile/sessions
DELETE /api/v1/mobile/sessions/:id

POST   /api/v1/kiosk/session/start
POST   /api/v1/kiosk/session/verify
GET    /api/v1/kiosk/session/summary
POST   /api/v1/kiosk/invoices/:id/pix
POST   /api/v1/kiosk/session/end
POST   /api/v1/kiosk/heartbeat
```

Mobile e kiosk podem atuar como BFFs lógicos dentro do monólito, sem novo serviço. DTOs são mínimos e não reutilizam diretamente entidades administrativas.

## 11. Modelo adicional

```text
student_accounts
student_sessions
account_activation_tokens
password_reset_tokens
mobile_devices
push_subscriptions
kiosk_devices
kiosk_sessions
kiosk_audit_events
rotating_qr_tokens
```

Tokens são persistidos apenas como hash quando possível.

## 12. UX e acessibilidade

- suporte a fonte ampliada, leitor de tela, contraste e área de toque adequada;
- app explicita quando dado foi atualizado;
- totem oferece alto contraste, teclado acessível e tempo adicional sob solicitação;
- erros informam ação possível sem expor detalhes técnicos;
- processo financeiro preserva contexto após retorno seguro;
- gráficos possuem alternativa tabular;
- ações destrutivas e logout mostram confirmação apropriada.

## 13. Segurança

- certificate pinning só será adotado com estratégia de rotação e benefício comprovado;
- proteção contra root/jailbreak gera sinal de risco, não bloqueio cego neste MVP;
- deep links usam allowlist e token de uso único;
- WebView de pagamento aceita apenas hosts homologados;
- kiosk usa allowlist de navegação, bloqueio de devtools operacional e usuário Windows restrito;
- câmera, impressão e clipboard são limpos após a jornada;
- logs de crash removem PII e payloads financeiros/saúde;
- APIs aplicam rate limit e detecção de enumeração.

## 14. Requisitos não funcionais

- `M4-NFR-001`: Home mobile p95 menor que 2,5 s na conexão de referência.
- `M4-NFR-002`: app inicia com shell útil durante indisponibilidade, sem exibir dado sensível obsoleto como atual.
- `M4-NFR-003`: crash-free sessions mínimo de 99,5% no piloto.
- `M4-NFR-004`: kiosk volta à tela inicial e limpa estado até 2 s após fim da sessão.
- `M4-NFR-005`: QR suporta validação sob pico sem depender do cliente para regra.
- `M4-NFR-006`: APIs mobile/kiosk passam testes de autorização por recurso.
- `M4-NFR-007`: WCAG 2.2 AA para web kiosk e práticas equivalentes de acessibilidade mobile.
- `M4-NFR-008`: versão mínima e atualização forçada são configuráveis com período de tolerância.

## 15. Testes obrigatórios

- ativação expirada, reutilizada, interceptada e de outro aluno;
- refresh token rotacionado e replay;
- deep link malicioso;
- QR válido, expirado, reutilizado e adulterado;
- fechamento do app durante PIX e retorno posterior;
- autorização por objeto em todos os endpoints mobile;
- sessão kiosk por timeout, erro, perda de rede e reinício do navegador;
- usuário A seguido de usuário B sem vazamento visual, cache, autofill ou impressão;
- WebView limitado aos hosts de pagamento;
- acessibilidade automatizada e manual;
- E2E em dispositivos de referência Android/iOS e hardware do totem.

## 16. Critérios de aceite

- `M4-AC-001`: aluno ativa conta sem intervenção administrativa sobre senha.
- `M4-AC-002`: sessão revogada deixa de renovar acesso.
- `M4-AC-003`: carteirinha mostra dados corretos e QR expirado é recusado.
- `M4-AC-004`: app consulta plano, frequência, invoices e avaliações próprias.
- `M4-AC-005`: pagamento iniciado duas vezes com a mesma chave não duplica cobrança lógica.
- `M4-AC-006`: retorno do checkout sem webhook não ativa entitlement.
- `M4-AC-007`: totem não autentica apenas com CPF.
- `M4-AC-008`: sessão do totem expira e remove todo estado do aluno anterior.
- `M4-AC-009`: pagamento confirmado no totem restaura entitlement pelo backend.
- `M4-AC-010`: operador consulta health e versão sem abrir sessão de aluno.
- `M4-AC-011`: piloto atinge metas de login, crash e autosserviço definidas.

## 17. Rollout

1. distribuição interna para equipe;
2. grupo pequeno de alunos consentidos;
3. um totem em ambiente assistido;
4. financeiro habilitado após jornadas de leitura estáveis;
5. rollout mobile em percentuais e kiosk por unidade;
6. publicação ampla com suporte e monitoramento.

Feature flags: `STUDENT_MOBILE`, `MOBILE_PAYMENTS`, `KIOSK`, `KIOSK_PAYMENTS`, `PUSH_NOTIFICATIONS`.

## 18. Checklist

- [ ] Gates de identidade, kiosk e distribuição aprovados
- [ ] Slice 4.1 — Identidade e shell mobile
- [ ] Slice 4.2 — Carteirinha, plano e frequência
- [ ] Slice 4.3 — Financeiro mobile
- [ ] Slice 4.4 — Avaliações e consentimentos
- [ ] Slice 4.5 — Kiosk seguro
- [ ] Slice 4.6 — Pagamento e desbloqueio
- [ ] Slice 4.7 — Piloto e distribuição
