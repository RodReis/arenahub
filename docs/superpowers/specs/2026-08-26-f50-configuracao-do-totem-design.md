# F50 — Contrato de configuração, painel e publicação versionada

**Data:** 26/08/2026 · **Fatia:** F50 · **Spec:** SPEC-050 · **Slice:** 3.5.2 do MVP 3.5
**Issue:** [#151](https://github.com/RodReis/arenahub/issues/151)
**Fontes:** [ADR-042](../../DECISIONS.md#adr-042) (Decisões 0, 3, 5, 6, 8) ·
`M3.5-FR-001` a `003`, `M3.5-BR-002`, `M3.5-BR-003`, `M3.5-BR-005` ·
[`DS-TOTEM.md`](../../design/DS-TOTEM.md) §7.2 · base entregue pela
[F49](2026-08-25-f49-kiosk-seguro-design.md)

---

## 0. Decisões do PI tomadas em 26/08/2026

Três perguntas foram ao PI antes de escrever código. As respostas **estreitam** a issue #151 em
dois pontos e resolvem uma inconsistência entre o ADR-042 e o arquivo que ele diz emendar.

| # | pergunta | decisão |
|---|---|---|
| 1 | O ADR-042 manda editar `DS-TOTEM.md` **§11 regra 9**, mas o arquivo tem só 8 seções | **Registrar e não editar §11.** A mecânica entra em **§7.2**, que é a seção real de configuração; a discrepância é registrada no PR e no `STATUS.md` para o Cowork alinhar ADR e documento depois |
| 2 | A issue lista `kiosk_config_blocks`, `kiosk_sponsors` e `kiosk_media_assets` no modelo | **Ficam para a F51.** Blocos, patrocínio e mídia são o escopo dela; tabela que nenhuma tela desta fatia escreve é código morto até lá |
| 3 | Onde mora o painel no `admin-web` | **`/operations/kiosks`** — totem é dispositivo de operação, ao lado de `/operations/devices` |

### Por que a decisão 1 não é preguiça documental

O ADR-042 declara *"Alcança `docs/design/DS-TOTEM.md` §11 regra 9 e §12 pendências 1 e 4"* e cita
ainda §9.1, §11.2, §11.3, §11.5, §11.6, §11.7, §11.8 e §11.10. **Nenhuma dessas seções existe.**
O `DS-TOTEM.md` vai de §1 a §8. O ADR referencia uma versão do documento que nunca foi escrita
nessa forma — ou foi escrita e perdida antes de entrar no repositório.

Inventar §9 a §12 para o arquivo bater com o ADR significaria **escrever conteúdo normativo de
design que ninguém decidiu**, num arquivo que é contrato de implementação de UI (ADR-026). O
Code não cria regra: segue a que está especificada. Então a mecânica da Decisão 3 vai para §7.2 —
onde o assunto (o que a academia configura) de fato mora — e a inconsistência fica **anotada, não
apagada**.

### Por que a decisão 2 não contraria a Decisão 0 do ADR-042

A Decisão 0 exige que **a tela do totem leia tudo da configuração desde o primeiro commit** — e
isso já aconteceu: a F49 entregou `kioskConfigSchema` cobrindo o §7.2 inteiro, incluindo `modulos`
e `identificacao`, que só a F52 vai usar de verdade. O contrato está completo.

O que a decisão 2 adia são **tabelas relacionais novas** (`kiosk_config_blocks`, `kiosk_sponsors`,
`kiosk_media_assets`) — que não são o contrato, são armazenamento de conteúdo que ainda não tem
tela que o escreva nem tela que o leia. A Decisão 0 fala de *ler config em vez de fixar valor*;
não manda criar tabela vazia com um MVP de antecedência.

---

## 1. Escopo

### Entra

- Rotas administrativas de configuração do totem: ler, escrever rascunho, publicar, descartar
- Publicação **versionada e imutável** (ADR-042, Decisão 3) — `publish` cria versão nova
- Painel *Personalização do totem* no `admin-web`, abas **Marca**, **Aparência** e **Sessão**
- Lista de totens em `/operations/kiosks`, porta de entrada para a configuração de cada um
- No `apps/kiosk`: comparar `configVersion` do heartbeat com a do boot e **reiniciar fora de sessão**
- Estado de publicação *"aguardando o totem ficar livre"* — é estado, não erro
- `DS-TOTEM.md` §7.2 ganha a mecânica da Decisão 3

### Não entra

| fora | dono |
|---|---|
| Abas **Blocos públicos** e **Módulos** | **F51** e **F52** |
| `kiosk_config_blocks`, `kiosk_sponsors`, `kiosk_media_assets` | **F51** (decisão 2 do PI) |
| Upload de mídia, MP4, link do Instagram | **F51** (ADR-042, Decisão 7) |
| Pré-visualização das sete telas do totem dentro do painel | **F51** — precisa dos blocos para ter o que pré-visualizar |
| Provisionamento de totem novo pelo painel (emitir credencial HMAC) | fora do MVP 3.5 — a F49 provisiona por seed |
| Criar `DS-TOTEM.md` §9 a §12 | Cowork / PI (decisão 1) |

---

## 2. O que a F49 já entregou e esta fatia consome

Esta fatia **escreve** no que a F49 já **lê**. Nada do lado do contrato precisa mudar.

| ativo da F49 | uso na F50 |
|---|---|
| `KioskConfiguration` com `version` e `publishedAt` | rascunho é a linha sem `publishedAt`; publicar carimba |
| `kioskConfigSchema` + `CONFIG_PADRAO_DO_TOTEM` | validação do que o painel envia; padrão quando não há nada publicado |
| `resolverConfig()` — três camadas, pura | reaproveitada para a pré-visualização do efeito no painel |
| `GET /api/v1/kiosk/config` | inalterado: continua servindo **só publicado** |
| `POST /api/v1/kiosk/heartbeat` devolvendo `configVersion` | inalterado no servidor; o **totem** passa a comparar |
| `KioskDevice.bootConfigVersion` | a coluna existe desde a F49 esperando exatamente este uso |

**A soma de versões das três camadas** (`kiosk-config.service.ts`) é o `configVersion`. A F49
escolheu soma em vez do maior número porque cada camada tem contador próprio pela unique
constraint. Isso vale intacto aqui: publicar em qualquer camada muda a soma, e é isso que o totem
detecta.

---

## 3. Modelo de dados

**Nenhuma migração nova.** `kiosk_configurations` já tem tudo:

```
id · tenant_id · gym_unit_id? · kiosk_device_id? · version · published_at? · payload · created_at
@@unique([tenantId, gymUnitId, kioskDeviceId, version])
```

A nulabilidade **é** a camada (ADR-042, Decisão 8):

```
tenant      → gym_unit_id NULL, kiosk_device_id NULL
gym_unit    → gym_unit_id preenchido, kiosk_device_id NULL
dispositivo → ambos preenchidos
```

### Rascunho e publicado na mesma tabela

| linha | `published_at` | significado |
|---|---|---|
| rascunho | `NULL` | edição em andamento; invisível para o totem |
| publicada | preenchido | imutável; é o que `GET /kiosk/config` serve |

**Invariante: no máximo um rascunho por camada.** Sem isso, "descartar" fica ambíguo e "publicar"
não sabe qual linha promover. A garantia vai em **índice parcial**, não em `if` na aplicação:

```sql
CREATE UNIQUE INDEX kiosk_configurations_rascunho_unico
  ON kiosk_configurations (tenant_id, gym_unit_id, kiosk_device_id)
  WHERE published_at IS NULL;
```

Índice parcial com colunas nulas exige cuidado: no Postgres, `NULL` não colide com `NULL` num
índice único comum. Aqui a coluna nula **é** parte da identidade da camada, então a comparação
precisa ser feita com valores substitutos não-nulos — a alternativa é uma expressão
`COALESCE(gym_unit_id, '00000000-...')`. **A decisão fica para a implementação**, provada por
teste que tenta criar dois rascunhos da mesma camada e espera recusa.

> Registro de risco conhecido: [[indice-parcial-erra-a-cardinalidade]] — índice parcial escrito no
> lado errado da relação recusa o caso legítimo, e o teste passa pelo motivo errado. O teste desta
> invariante precisa provar **as duas** direções: dois rascunhos da mesma camada são recusados, e
> dois rascunhos de camadas **diferentes** são aceitos.

### Publicar nunca altera a linha publicada

```
publish:  lê rascunho → calcula version = max(version da camada) + 1
          → INSERT nova linha com published_at = agora
          → DELETE do rascunho
```

Isso é o que torna a operação reversível: a versão anterior continua na tabela. E é o que dá ao
heartbeat um número que só anda para frente.

---

## 4. API — módulo `kiosk-admin`

Módulo **novo** e separado de `kiosk`. Razão: o módulo `kiosk` é autenticado por **HMAC de
dispositivo** (`@KioskRoute()`); estas rotas são autenticadas pela **sessão do gerente**. Misturar
os dois regimes no mesmo controller é como um totem acaba conseguindo escrever a própria
configuração.

```
GET    /api/v1/admin/kiosk-devices/:id/config
PUT    /api/v1/admin/kiosk-devices/:id/config
POST   /api/v1/admin/kiosk-devices/:id/config/publish
DELETE /api/v1/admin/kiosk-devices/:id/config/draft
```

Mais uma rota de listagem, que a tela precisa e a issue não menciona:

```
GET    /api/v1/admin/kiosk-devices
```

### Contrato de resposta do `GET .../config`

```ts
{
  publicada: { version: number; config: KioskConfig } | null,
  rascunho:  { config: KioskConfig } | null,
  efetiva:   KioskConfig,      // resolverConfig das três camadas publicadas
  configVersion: number,       // a soma que o totem compara
  totemEmSessao: boolean       // decide a mensagem de publicação
}
```

`efetiva` existe para o painel mostrar **o que o totem exibe hoje**, que não é o mesmo que a
configuração desta camada — herança de tenant e unidade entra aí.

### Isolamento de tenant

`tenantId` vem da identidade autenticada, nunca do corpo nem da query (Regra de arquitetura 2).
Todo acesso a `:id` valida que o `KioskDevice` pertence ao tenant do chamador **antes** de
qualquer leitura de configuração — device de outro tenant responde 404, não 403: quem não pode ver
não deve nem saber que existe.

### Camada alvo

O `PUT` escreve na camada que o painel está editando. Nesta fatia o painel edita **dispositivo**
(a rota é por `:id` de device), e a camada de tenant e unidade são leitura — o `efetiva` mostra a
herança. Editar camadas superiores é tela que a F51 acrescenta junto com blocos, que são por
unidade por natureza.

---

## 5. Publicação e reinício da superfície (ADR-042, Decisão 3)

O conflito que a Decisão 3 resolve: `DS-TOTEM` manda resolver accent **no provisionamento, nunca
em runtime** — mas configuração publicada precisa chegar ao totem. A saída é não aplicar em
runtime: **reiniciar**.

```
1. gerente publica            → versão nova e imutável
2. totem bate heartbeat       → recebe configVersion
3. igual à do boot?           → nada acontece
4. diferente, sem sessão      → baixa, valida e REINICIA
5. diferente, com sessão      → espera o encerramento, reinicia no atrator
```

**Custo aceito e que a tela precisa dizer:** a mudança não é instantânea. Com aluno usando o
totem, o painel mostra *"aguardando o totem ficar livre"* — estado de publicação, não falha.

`totemEmSessao` sai de `KioskSession` com `endedAt = null` e `expiresAt` no futuro. Sessão
expirada mas não encerrada **não** conta como ocupada — senão um aluno que abandonou o totem
travaria a publicação até alguém tocar na tela.

### No `apps/kiosk`

O heartbeat já roda (F49). Acrescenta-se: guardar a versão do boot, comparar a cada heartbeat, e
quando divergir e não houver sessão, recarregar a aplicação. Com sessão aberta, marcar a intenção
e reiniciar no `encerrar`.

Reiniciar é `window.location.reload()` — não gestão de estado. A superfície inteira relê a
configuração no boot, que é exatamente a garantia que a regra do DS quer.

---

## 6. Painel — `/operations/kiosks`

```
/operations/kiosks              lista de totens: código, unidade, último heartbeat, versão
/operations/kiosks/[id]         Personalização do totem — três abas
```

| aba | campos | fonte |
|---|---|---|
| **Marca** | nome da academia, nome da unidade, slogan, logotipo (URL) | `kioskConfigSchema.marca` |
| **Aparência** | accent (quatro opções), alto contraste padrão | `.aparencia` |
| **Sessão** | duração (45/60/90/120), aviso sonoro na recusa | `.sessao` |

Incremento (30 s) e teto (99 s) são `z.literal` no contrato — aparecem como **texto fixo**, não
campo. Mostrar controle desabilitado para valor que nunca muda é ruído.

### O que a tela deixa explícito

- **Cor de destaque é escolha entre quatro**, nunca hex livre (Decisão 6). O tom aplicado é
  derivado por contraste sobre carbono — o painel mostra as quatro como amostras, não um seletor.
- **Precedência do alto contraste.** O interruptor define o **padrão de boot da unidade**. O botão
  na tela do totem é **do aluno**, vale para a sessão dele e **sempre vence**. A tela diz isso com
  todas as letras: gerente não desliga acessibilidade de quem está usando.
- **Herança visível.** Campo não sobrescrito nesta camada mostra o valor herdado, de onde vem, e
  como sobrescrever.

### Rascunho, publicar, descartar

Barra fixa com o estado: *sem alterações* · *rascunho não publicado* · *aguardando o totem ficar
livre*. **Publicar** e **Descartar** só existem quando há rascunho. Descartar pede confirmação —
é destrutivo e não tem desfazer.

### Design

Segue `DS-PAINEL.md` — é tela de painel, não de totem. Os tokens de 7:1 e alvo de 88 px são do
`apps/kiosk`; aplicá-los aqui deixaria o painel com cara de totem. `Toast` para retorno, nunca
`Alert` (convenção do projeto).

---

## 7. Testes

| nível | prova |
|---|---|
| unidade | promoção de rascunho a versão: numeração por camada, publicada intacta |
| unidade | `totemEmSessao` — sessão expirada não conta como ocupada |
| integração | as cinco rotas: device de outro tenant responde 404 |
| integração | dois rascunhos da mesma camada recusados; de camadas diferentes aceitos |
| integração | publicar não altera a linha publicada anterior |
| integração | `GET /api/v1/kiosk/config` continua servindo só publicado, nunca rascunho |
| componente | as três abas: herança exibida, accent como quatro amostras, literais como texto |
| E2E | **o aceite**: altera → publica → *Descartar* restaura o publicado |

**A guarda que importa:** o teste de isolamento precisa provar que o `tenantId` sai da identidade.
Um teste que passa `tenantId` no corpo e vê a rota ignorá-lo prova mais que um que só confere o
resultado feliz.

> [[duble-esconde-ato-errado]]: assertar o **estado no banco** depois de publicar, não o id que a
> rota devolve. Uma implementação que devolve o id certo e grava a linha errada passa no segundo.

---

## 8. Aceite

> O gerente altera marca, cor e sessão, publica, e o totem reflete a mudança **sem interromper
> aluno em sessão**. *Descartar* restaura o publicado.

Verificável assim:

1. Totem em `configVersion` N, sem sessão → gerente publica → heartbeat devolve N+1 → totem
   reinicia com a marca nova.
2. Totem **com sessão aberta** → gerente publica → o painel mostra *aguardando o totem ficar
   livre* → o totem só reinicia depois que a sessão encerra.
3. Gerente edita, não publica, clica *Descartar* → volta ao publicado; o totem nunca viu nada.

---

## 9. Riscos e o que fica registrado

| risco | tratamento |
|---|---|
| `DS-TOTEM.md` §9–§12 não existem, e o ADR-042 os referencia | registrado no PR e no `STATUS.md`; a mecânica vai para §7.2 (decisão 1 do PI) |
| Índice parcial com coluna nula pode recusar o caso legítimo | teste prova as duas direções: mesma camada recusa, camadas diferentes aceitam |
| Publicação com sessão pendurada trava o totem indefinidamente | sessão **expirada** não conta como ocupada |
| Um totem escrever a própria configuração | módulo separado: `kiosk` é HMAC de dispositivo, `kiosk-admin` é sessão de gerente |
