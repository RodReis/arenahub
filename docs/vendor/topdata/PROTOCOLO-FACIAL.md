# Protocolo do leitor facial Topdata — o que os manuais dizem

> **Fonte:** *Manual de Comandos do Leitor Facial — cadastro de usuários*, Rev. 03 (30/01/2025),
> e *Manual SDK Leitor de Biometria Facial*, Rev. 05 (27/09/2024). Recebidos do PI em
> 14/08/2026.
>
> **Este arquivo é resumo de leitura, não substitui os manuais.** Onde divergir, o manual vence.
> Serve para o código citar uma fonte verificável em vez de repetir o manual inteiro em
> comentário.

Modelos cobertos: leitores **F4, T4, T4-50k** em **Catraca Fit**, Revolution, Box, Inner Ponto 4,
Inner Acesso 2. A bancada é uma **Catraca Fit** — coberta.

---

## A arquitetura é invertida: nós somos o servidor

> *"O aplicativo atua como um **servidor WebSocket**, enquanto o leitor facial atua como um
> **cliente WebSocket**."*

| | |
|---|---|
| protocolo | **WebSocket**, mensagens **JSON** |
| endpoint | `/pub/chat` |
| porta padrão | **7792** (configurável no leitor: `MENU → REDE → SERVIDOR → Porta`) |
| quem conecta | **o leitor**, no IP do PC configurado em `MENU → REDE → SERVIDOR → IP` |

**Consequência para o ADR-010:** não há DLL no caminho de dados. O `edge-agent` sobe um
servidor WebSocket e espera o leitor conectar. Isso é Node puro — nenhuma dependência de
Windows no transporte.

**Consequência para o `edge-agent`:** ele **não conecta ao leitor**; ele **escuta**. A porta do
servidor é configuração nossa; o IP do leitor (`192.168.2.188` na bancada) serve para
diagnóstico e inventário, não para abrir conexão.

## `reg` — o handshake, e a resposta é obrigatória

O leitor envia ao conectar:

```json
{"cmd":"reg","sn":"AIPK02000562","devinfo":{"modelname":"AiFace","usersize":5000,
 "facesize":5000,"firmware":"AiF43V_v4.30","time":"2022-11-24 10:28:07", ...}}
```

**O aplicativo TEM de responder:**

```json
{"ret":"reg","result":true,"cloudtime":"2016-03-25 13:49:30"}
```

> ⚠️ *"Caso a resposta não seja enviada, **a comunicação com o leitor facial será perdida**."*

O `sn` é o número de série — **é ele que identifica o dispositivo**, não o IP. Na bancada:
`AYTI11108174` no campo *"Leitor facial 1"* do software da catraca.

## Ciclo de vida do usuário

| comando | direção | o que faz |
|---|---|---|
| `disabledevice` | envio | suspende o tratamento de acessos. **Necessário antes de outros comandos** |
| `enabledevice` | envio | volta a validar acesso |
| `setuserinfo` | envio | cadastra ou atualiza |
| `deleteuser` | envio | remove |
| `getuserlist` | envio | lista, **paginada** |
| `getuserinfo` | envio | detalhe de um usuário |
| `cleanuser` | envio | **apaga todos** |
| `sendlog` | recebimento | evento de acesso ou de desconhecido |

### `backupnum` — o discriminador de tipo de dado

Aparece em quase todo comando e muda o significado do campo `record`:

| valor | significa |
|---|---|
| `0` | usuário **sem** foto (nome, admin, cartão, senha). `record` deve ser `"0"` |
| `10` | senha |
| `11` | cartão |
| `13` | todos, **exceto** biometria |
| `50` | **foto** — `record` é a imagem em Base64 |

O manual recomenda **usar só `0` e `50`** para envio completo; os outros existem por
compatibilidade.

### `enrollid` — e o problema que ele cria para nós

> *"Corresponde ao identificador do usuário. Obrigatório que o valor deve estar compreendido
> entre **1 e 999.999.999.999**."* (12 dígitos)

> *"O Leitor Facial possui em suas configurações quantidade de dígitos pré-definidos de ID do
> usuário, que são de 9, 18 ou 30 dígitos. Para utilizar ID com o máximo de dígitos permitidos
> pelo SDK, que são 12 dígitos, é necessário acessar o menu... e selecionar a quantidade de 18
> dígitos."*

⚠️ **É numérico, com 12 dígitos.** O `externalEnrollId` da F2 nasceu como UUID hexadecimal de
32 caracteres e **não cabe**. Ver `apps/edge-agent/src/domain/external-enroll-id.ts` — a regra de
não derivar de CPF continua valendo, a implementação mudou.

⚠️ **Configuração de bancada obrigatória:** o leitor precisa estar em **18 dígitos** no menu, ou o
`enrollid` de 12 dígitos é recusado.

## Paginação de `getuserlist`

`stn: true` inicia; `stn: false` pede a próxima página.

> *"O aplicativo deve continuar enviando `getuserlist` com `stn: false` até que o campo `to` na
> resposta seja igual ao `count`."*

⚠️ **Os exemplos do manual contradizem essa regra.** Em `SDK Leitor de Biometria Facial` §5.7.1,
o último pacote vem com `count: 0, from: 0, to: 0, record: []` — ou seja, **o fim é sinalizado por
lista vazia**, não por `to == count`. Tratar os dois: parar em lista vazia **ou** em `to >= count`,
o que vier primeiro.

## `sendlog` — o evento, e o que ele traz de sensível

```json
{"cmd":"sendlog","sn":"...","count":1,"logindex":123,
 "record":[{"enrollid":12345,"name":"...","time":"2023-12-27 10:00:00",
            "mode":1,"inout":0,"event":0,
            "image":"data:image/jpeg;base64,..."}]}
```

| campo | significa |
|---|---|
| `mode` | modo de autenticação (`1` = facial) |
| `inout` | sentido (`0` = entrada) |
| `event` | `0` = autenticação · `2` = **desconhecido** |
| `enrollid` | `99999999` é o **ID especial de desconhecido** |
| `image` | **foto em Base64** |

> 🔴 **`image` é dado biométrico chegando no `edge-agent`.** Cai direto na regra de arquitetura
> nº 7 e no ADR-008. O envio é **configurável** por `setdevinfo`:
>
> - `use_logphoto: 0` — não manda foto no log de acesso;
> - `stranger_photo: 0` — não manda foto de desconhecido.
>
> **Ambos devem ficar em `0` até haver decisão do PI.** Receber foto de quem não consentiu —
> que é exatamente o caso do `stranger_photo` — é tratamento de dado biométrico sem base
> legal.

## Requisitos da foto de cadastro

- JPG ou JPEG, **menor que 150 KB**
- entre 240×320 e 800×1280 px; **recomendado 480×640**
- rosto vertical, sem máscara/boné/óculos escuros, uma pessoa só
- *"Fotos com tamanho e resolução fora da especificação serão rejeitadas pelo leitor"*

## O que os manuais **não** cobrem

**O comando de liberação da catraca não está aqui.** Estes dois manuais tratam do **leitor
facial** — cadastro de usuário e eventos. Girar a catraca é o **SDK EasyInner**, que é outro
documento.

Ou seja: **F2 está destravada, F3 continua parcialmente travada.** O `TurnstileAdapter` precisa
da documentação do EasyInner, e a F1 já registrou que comandar a catraca exige janela
combinada e procedimento de parada de emergência.
