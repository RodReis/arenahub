# F51 — Tela pública (hero): blocos, mídia e patrocínio

**Data:** 26/08/2026 · **Fatia:** F51 · **Spec:** SPEC-051 · **Slice:** 3.5.3 do MVP 3.5
**Issue:** [#152](https://github.com/RodReis/arenahub/issues/152)
**Fontes:** [ADR-042](../../DECISIONS.md#adr-042) (Decisões 4 e 7) ·
`M3.5-FR-004` a `006`, `M3.5-BR-001`, `M3.5-BR-006` ·
[`DS-TOTEM.md`](../../design/DS-TOTEM.md) §4 e §7.2 · base entregue pela
[F50](2026-08-26-f50-configuracao-do-totem-design.md)

---

## 0. Decisões do PI tomadas em 26/08/2026

Quatro perguntas foram ao PI antes de escrever código. Duas **estreitam** a issue #152 e duas a
**alargam** — e uma delas exige emenda de leitura de um requisito já aceito.

| # | pergunta | decisão |
|---|---|---|
| 1 | A Decisão 7 manda extrair reel do Instagram com `yt-dlp`, binário que não existe na imagem da API nem no CI | **Só MP4 na F51.** A porta `ExtratorDeMidiaExterna` e o dublê entram; o adapter real com `yt-dlp` vira fatia `[INFRA]` própria. O campo de link e a mensagem de risco já aparecem no painel, desabilitados com o motivo em tela |
| 2 | Quais dos cinco blocos entram | **Os cinco.** Incluindo *informações ao vivo* com número **real**, vindo da API |
| 3 | Número ao vivo colide com `M3.5-FR-005` (*"sem rede na tela pública"*) | **Número ao vivo com último valor em cache**, buscado no heartbeat que já existe. Sem rede, o bloco mostra o último número conhecido — nunca some. O FR-005 continua literal para **mídia** |
| 4 | Quais indicadores | **Check-ins de hoje na unidade** e **treinando agora** (estimativa por janela) |

### Por que a decisão 3 é emenda de leitura, e não violação

`M3.5-FR-005` diz: *"servir toda mídia do cache local, sem rede e sem script de terceiro na tela
pública"*. O aceite da fatia repete: *"sem rede disponível, servindo mídia do cache local"*.

**As duas frases falam de MÍDIA.** Vídeo, logotipo e imagem continuam servidos do cache local e do
object storage — nenhum byte de mídia é buscado em runtime, nenhum script de terceiro é carregado.

O que a decisão 3 acrescenta é **um número de texto**, buscado no `POST /kiosk/heartbeat` que a F49
já dispara a cada 30 s — a mesma requisição, um campo a mais na resposta. Ele é **guardado em
memória** e, sem rede, o bloco exibe o último valor conhecido com a hora da leitura. A tela pública
**nunca depende da rede para renderizar**: essa é a garantia que o FR-005 protege, e ela continua
verdadeira.

**O que seria violação, e não é o que se faz aqui:** um `fetch` próprio da tela pública, um bloco
que some quando o link cai, ou um `<script src>` apontando para fora.

### Por que a decisão 1 não deixa dívida no contrato

O campo `linkExterno` **existe no schema desde este commit** e o painel já o mostra — é a Decisão 0
do ADR-042 aplicada à mídia: quando o adapter real chegar, nenhuma tabela, nenhum contrato e
nenhuma tela mudam. O que falta é **um adapter**, atrás de uma porta que já está no lugar.

---

## 1. Escopo

### Entra

- `KioskConfig` ganha `blocos` (cinco tipos, ordem, tempo por bloco) e `patrocinio`
- Aba **Blocos públicos** no painel: ligar, desligar, reordenar, editar conteúdo de cada bloco
- Upload de MP4 até 40 MB — assinatura de arquivo, **antivírus antes do storage**, chave gerada pelo servidor
- Faixa de patrocinadores: até 6 marcas, nome + logotipo, rótulo obrigatório, fixa no rodapé
- Na hero do `apps/kiosk`: rodízio dos blocos habilitados na ordem e no tempo configurados
- Indicadores ao vivo (check-ins de hoje, treinando agora) no heartbeat, com último valor em cache
- Mídia servida por URL assinada resolvida **no boot** — a tela pública nunca busca em runtime

### Não entra

| fora | dono |
|---|---|
| Adapter real de extração do Instagram (`yt-dlp`, `ffmpeg` na imagem e no CI) | fatia `[INFRA]` própria (decisão 1 do PI) |
| Contagem de impressão, clique, QR ou período de veiculação no patrocínio | **nunca** — ADR-042, Decisão 4, e o gatilho de revisão que ela define |
| Aba **Módulos** e a jornada do aluno | **F52** |
| Pré-visualização das sete telas do totem dentro do painel | **F52** — depende da área interna existir |

---

## 2. Modelo de dados

**Nenhuma tabela nova.** Blocos e patrocínio entram no `payload` de `kiosk_configurations`, que já
é `Json` — pelo mesmo motivo que marca, aparência e sessão entraram lá na F49:

1. **São configuração, não entidade de negócio.** Ninguém consulta bloco por id, ninguém relaciona
   bloco com aluno, ninguém audita bloco isoladamente. O que se audita é a **versão publicada
   inteira** — e isso a linha versionada já dá.
2. **A publicação versionada e imutável exige o conjunto junto.** Bloco em tabela relacional
   separada tornaria "publicar a versão 7" um problema de cópia de N linhas, e "voltar para a 6"
   um problema de restauração. No `payload`, ambos são a linha que já existe.
3. O design da F50 previu `kiosk_config_blocks`, `kiosk_sponsors` e `kiosk_media_assets` para cá.
   **Nenhuma das três se justifica** depois de olhar o que elas armazenariam: uma lista ordenada
   com no máximo 5 itens e uma com no máximo 6.

**A mídia é a exceção, e por um motivo concreto:** o arquivo MP4 não vive no `payload` — vive no
object storage, e a config guarda **a chave**.

### A chave do objeto

```
tenants/{tenantId}/kiosk-media/{gymUnitId}/{uuid}.mp4
```

Servidor gera, cliente nunca escolhe prefixo — mesma disciplina de `montarChaveDeCadastro`.

---

## 3. O contrato

```
blocos: {
  tempoPorBlocoSegundos: 8 | 12 | 20 | 30
  itens: Array<Bloco>          // ordem do array É a ordem do rodízio
}
patrocinio: {
  habilitado: boolean
  rotulo: string               // vazio cai no padrão "Espaço patrocinado"
  marcas: Array<{ nome, logotipoUrl }>   // no máximo 6
}
```

Cinco tipos de bloco, discriminados por `tipo`:

| tipo | conteúdo | origem do dado |
|---|---|---|
| `VIDEO` | título, legenda, `midiaKey` **ou** `linkExterno` | upload (MP4) — link fica para a fatia INFRA |
| `EVENTOS` | até 4 itens: data, título, informação curta | digitado no painel |
| `MATERIAL` | título, resumo, URL para o QR | digitado no painel |
| `INSTAGRAM` | `@perfil`, chamada | digitado no painel |
| `INFORMACOES` | rótulo, indicadores habilitados | **API** — check-ins de hoje, treinando agora |

**Rodízio, não empilhamento.** O `DS-TOTEM.md` §4 desenha os blocos empilhados na vertical; a issue
#152 e o `M3.5-FR-004` falam em *"rodar os blocos habilitados na ordem definida, com tempo por
bloco"*. Onde divergem, o ADR vence: **um bloco por vez**, trocando no tempo configurado. Isso
também satisfaz a regra do §4 *"no máximo um bloco de mídia visível por vez"* por construção.

Fixos, fora do rodízio: cabeçalho, hero, CTA e a faixa de patrocinadores.

---

## 4. `M3.5-BR-001` — o que a tela pública nunca mostra

A trava é **estrutural, não uma revisão de código**: o componente da hero recebe `config` e
`indicadores`, e **nenhuma prop por onde um dado de aluno entraria**. `SessaoDoAluno` não é
importado no arquivo. Os indicadores são **contagens** — números agregados da unidade, sem
`studentId` em lugar nenhum do caminho.

O endpoint que os produz devolve **dois inteiros**. Não devolve lista, não devolve nome, não
devolve id: o que não sai do servidor não vaza na tela.

---

## 5. Ordem das operações no upload — a defesa é a sequência

Herdada da F19 (`import.service.ts`), pelo mesmo motivo:

1. tamanho e tipo declarado (40 MB, `video/mp4`);
2. **assinatura do arquivo** — os bytes do container ISO-BMFF, não a extensão;
3. **antivírus** (`MalwareScanner`, ADR-017) — antes de qualquer coisa tocar o storage;
4. só então grava, com chave gerada pelo servidor;
5. a config passa a apontar para a chave.

Inverter 3 e 4 guardaria malware no bucket.

---

## 6. Plano de execução

| # | tarefa | onde |
|---|---|---|
| 1 | Contrato: `blocos` e `patrocinio` no `kioskConfigSchema` | `packages/api-contracts` |
| 2 | Upload de mídia: assinatura, antivírus, storage | `apps/api/src/modules/kiosk-admin` |
| 3 | Indicadores da unidade no heartbeat | `apps/api/src/modules/kiosk` |
| 4 | Aba **Blocos públicos** no painel | `apps/admin-web` |
| 5 | Rodízio e blocos na hero, com cache de indicador | `apps/kiosk` |
| 6 | Documentação: `STATUS.md`, `DEVELOPMENT.md`, `TESTS.md`, `DS-TOTEM.md` §7.2 | `docs/` |
