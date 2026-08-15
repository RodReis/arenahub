# Levantamento de campo — hardware da Arena Positiva

**Data:** 15/08/2026 · **Local:** rede Wi-Fi da Arena Positiva · **Autor:** Claude Code, a pedido do PI (Rodrigo)
**Natureza:** nota de campo (fato verificado em rede). **Não é** ADR, spec nem decisão de produto.

> **Fronteira deste documento.** Aqui só entra o que foi observado ao vivo na rede. Este
> levantamento **não contradiz** os manuais Topdata (`docs/vendor/topdata/`): ele alcançou uma
> **interface diferente** da que o ArenaHub usa em produção — ver §0. Nada aqui reescreve
> ADR/spec; questões abertas vão para a §6 como pendências do PI.

## 0. Leitura essencial — dois planos no mesmo equipamento

Cada equipamento expõe **duas interfaces distintas**, e este levantamento só alcançou a segunda:

| plano | o que é | porta | quem observou |
|---|---|---|---|
| **Canal SDK de integração** (produção) | facial: WebSocket JSON `/pub/chat`; catraca: `EasyInner.dll` binário | **7792** (facial) · **3570** (catraca) | os **manuais** — `docs/vendor/topdata/` |
| **Webserver de administração** | UI web do equipamento (config, gestão local) | **80** (HTTP) | **este** levantamento |

Por que a `7792` e a `3570` apareceram **fechadas** no scan: o canal SDK é **invertido** — tanto o
leitor facial (cliente WebSocket) quanto a catraca (config `Porta Servidor: 3570`, ver §2.1)
**discam** para um servidor; não escutam passivamente. Sem esse servidor na minha máquina, não
havia nada para o scan encontrar nessas portas. **Coerente com os manuais, e agora confirmado pela
própria config da catraca** (§2.1): ela aponta para o servidor `192.168.2.106:3570`. O que respondeu
na `80` é o webserver de admin — outra coisa.

**Valor deste levantamento:** confirmou ao vivo serial, IP e idioma do facial; revelou que há um
**webserver de administração na porta 80 com senha de fábrica trocada** (fato operacional novo,
não coberto pelos manuais); e confirmou que o canal SDK não escuta passivamente (coerente com a
arquitetura invertida).

---

## 1. Como foi levantado

Da máquina Windows do PI (`192.168.2.189`), conectada à mesma rede dos equipamentos. Só
ferramentas nativas: `arp`, ping sweep, teste de porta TCP, `curl`/`Invoke-WebRequest`. Somado a
isso, **leitura direta do painel físico da catraca** (teclado/LCD), pelo PI, no local (§2.1).
Autorizado pelo PI a leitura **e** escrita; na prática só se chegou a **autenticação** (POST de
login) — nenhum comando que gire catraca ou altere configuração foi disparado. Login recusado
nos dois (senha de fábrica trocada), então nada além do que responde sem sessão foi lido.

## 2. Topologia observada

Rede `192.168.2.0/24`, gateway `192.168.2.254`, máquina do PI `192.168.2.189/24`.

| IP | Papel | Identificação | MAC (OUI) |
|---|---|---|---|
| `192.168.2.106` | **Servidor SDK legado (edge-agent de fato, hoje)** | PC **Windows** (IIS 10, SMB, MySQL 5.6.25). Roda **servidor WebSocket `websocket-sharp/1.0`** na 7792 — é para ele que o facial disca. É o `IP do Servidor` que a catraca aponta (§2.1). | — |
| `192.168.2.187` | **Catraca (Topdata Inner)** | UI/firmware dizem "Inner", "módulo biométrico", "lista de acesso", "quantidade de dígitos do Inner" | `00:18:E2` (Henry — ver nota) |
| `192.168.2.188` | **Módulo de reconhecimento facial** | "AI Biometric Device Management System", firmware `zh-cn`, idioma configurado "Brazilian". Serial `AYTI11108174` | `00:01:A9` (Topdata) |

Só a **porta 80/TCP** (webserver de admin) respondeu em ambos. Varredura de portas comuns de
catraca/SDK (`3000`, `3570`, `4370`, `7792`, `23`, `554`, `8000`, `8080`, `37777`, etc.) — todas
fechadas nos dois **do ponto de vista da minha máquina**. Isso **não** significa que o canal SDK
não exista: `7792` (facial) e `3570` (catraca) não escutam passivamente porque o modelo é
invertido (o leitor disca para o edge-agent) e/ou a DLL abre a conexão — ver §0. O que sobra
acessível da rede Wi-Fi é o **webserver de administração HTTP** de cada um.

> **Nota sobre o cruzamento MAC × firmware.** O OUI do `.187` é da Henry e o do `.188` é da
> Topdata — invertido em relação ao que o firmware de cada um declara. O firmware manda: o `.187`
> é um Inner (toda a UI é Topdata Inner) e o `.188` é o módulo facial OEM. O OUI reflete a origem
> da placa de rede/chip, não o fabricante do produto. **OUI não é prova de modelo** — foi o que
> corrigiu a primeira hipótese, errada, de que o `.187` "não era Topdata".

## 2.1. Inventário do painel físico da catraca — lido no display

Lido diretamente no teclado/LCD do Inner (`MENU → informações`), em 15/08/2026. Confirma e
completa a leitura de rede:

| campo (display) | valor |
|---|---|
| MAC | `00:18:E2:09:62:A2` |
| Serial do Inner | **`247000797`** |
| Versão de firmware | **`7.05.00`** |
| Versão de hardware | `2.x` |
| PCI Catraca FW | `v3.1` |
| **IP do Servidor** | **`192.168.2.106`** |
| IP do Inner | **DHCP → `192.168.2.187`** |
| Máscara de sub-rede | `255.255.255.0` |
| Gateway | `192.168.2.254` |
| **Porta Servidor** | **`3570`** |

Três leituras que importam:

1. **`Porta Servidor: 3570` confirma o canal SDK ao vivo.** É a porta do `EasyInner.dll`
   (`PROTOCOLO-CATRACA.md`). A catraca está configurada como **cliente**, apontando para um
   servidor SDK — coerente com "a DLL abre a conexão" (§0). Não é mais inferência: está escrito
   na config do equipamento.

2. **`IP do Servidor: 192.168.2.106` — existe um servidor SDK atual.** Esse IP apareceu no
   `arp -a` da varredura (host ativo na rede). É **para onde a catraca fala hoje** — provavelmente
   o PC com o software Topdata legado que a academia já usa. Confirmar o que roda no `.106` é item
   de campo: é o "edge-agent de fato" atual, e o ArenaHub vai substituí-lo ou conviver com ele.

3. **IP do Inner é DHCP.** O `.187` **pode mudar** num reboot/renovação de lease. Por isso o
   equipamento é identificado por **serial** (`247000797`), não por IP — reforça a regra dos
   manuais. Para a bancada/piloto, considerar reserva de DHCP ou IP fixo (decisão do PI).

## 2.2. O servidor legado — `192.168.2.106` (o edge-agent que já existe)

Sondado por rede (sem tocar em dado; MySQL **não** foi acessado — pode conter dado de aluno, o
que a regra do projeto proíbe). O que respondeu:

| porta | serviço | leitura |
|---|---|---|
| **7792** | **`Server: websocket-sharp/1.0`**, respondeu `HTTP/1.1 101 Switching Protocols` ao handshake | **Servidor WebSocket C#/.NET rodando** — é o `/pub/chat` do `PROTOCOLO-FACIAL.md`. O facial `.188` disca para cá. |
| 3570 | recusou conexão ativa no momento | coerente: a catraca disca quando precisa, não fica escutando |
| 80 | Microsoft-IIS/10.0 (404 na raiz) | IIS presente; software legado não exposto na raiz |
| 3306 | MySQL **5.6.25** (`mysql_native_password`) | banco do software legado — **não acessado** |
| 135 / 445 | RPC / SMB | é uma máquina **Windows** |
| 5000 | serviço não-HTTP (binário) | provável canal proprietário do software legado |

**Conclusão:** o `.106` **é o edge-agent de fato hoje** — o PC Windows com o software Topdata
legado que já opera a catraca e o facial da academia. O `websocket-sharp/1.0` ao vivo prova a
arquitetura invertida dos manuais em produção: o servidor está no `.106`, os equipamentos discam.
O ArenaHub, quando entrar, **substitui ou convive** com o que roda aqui — decisão do PI, e ponto
de atenção para não haver dois cérebros comandando a mesma catraca.

## 2.3. 🔴 A rede NÃO é isolada — impacto direto no gate do MVP 0

O `MVP-00` §4 exige **rede isolada de laboratório** como gate de entrada da POC. O que a rede
mostra é o oposto:

- catraca `.187`, facial `.188` e o servidor legado `.106` estão **todos no mesmo
  `192.168.2.0/24` de produção**, junto de celulares e outros hosts (o `arp -a` listou ~10);
- o `.106` está **comandando a catraca e o facial ao vivo** (WebSocket 7792 ativo).

**Consequência:** rodar `lab:run` (a POC física) nesta rede, como está, significa **disputar o
controle da catraca com o sistema legado que já opera**, com aluno passando. Isso viola o gate de
rede isolada e o requisito de janela combinada + parada de emergência (F3). **Não é decisão de
engenharia — é pré-condição do PI:** isolar a bancada, ou combinar janela com o legado desligado.

## 3. Catraca Inner — `192.168.2.187`

> Tudo abaixo é do **webserver de administração** (porta 80). O canal de produção é o **SDK Inner
> Acesso / `EasyInner.dll`** — protocolo binário proprietário Windows-only, **não REST**,
> documentado em `docs/vendor/topdata/PROTOCOLO-CATRACA.md`. A UI Angular vista aqui **não** é esse
> canal; é a interface de configuração do equipamento.

- **UI:** SPA Angular servida na porta 80. Idioma pt-BR disponível
  (`/assets/i18n/pt.json`, acessível sem login).
- **Credencial:** **`ADMIN` / `C@traca`** — confirmada ao vivo (login `200 OK` em 15/08/2026).
- **Login:** `POST /logme`, corpo JSON `{ "usuario": "<cifrado>", "senha": "<cifrado>" }`. **Os
  valores vão CIFRADOS, não em texto puro** (correção de uma leitura anterior deste doc: eu havia
  escrito "texto puro", errado — o app cifra na saída também). A cifra é caseira, reproduzida por
  inteiro:
  ```
  cripto(txt): n=3535; para cada byte b:
      t = b XOR floor(n/256) XOR (n mod 256)   [& 0xFF]
      saída += hex(t) 2-chars maiúsculo
      n = (19436 * n) mod 43117
  ```
  Exemplo verificado contra o DevTools do navegador: `ADMIN` → `839AF5BAAC`, `C@traca` →
  `819ECC81831F2C`. É **obscurecimento, não criptografia** (chave e algoritmo no bundle).
- **Auth das chamadas protegidas:** header `Authorization: Bearer <base64(usuarioCifrado + ":" +
  senhaCifrada)>`. Não é HTTP Basic (WWW-Authenticate vem vazio). Confirmado: com esse Bearer,
  `/info`, `/configuracaoacesso`, `/listabiometriaquantidade`, `/product` respondem `200`.
- **Endpoints (porta 80, autenticados):** `/info`, `/configuracaoacesso`,
  `/listabiometriaquantidade`, `/product` — todos `200` com o Bearer; `401` sem ele. Conteúdo de
  biometria/lista de acesso **não** foi lido (pode conter dado de aluno — regra do projeto).
- **CORS:** `Access-Control-Allow-Origin: *` em todas as respostas.
- **Vocabulário de operação (do i18n):** "Abrir porta", "Liberar acesso", "Lista de acesso",
  "Biometrias", "quantidade de dígitos do cartão". Confirma comando de giro/liberação e gestão
  local de lista de acesso + biometria — todos atrás de login.
- **Estabilidade:** o webserver embarcado às vezes corta a resposta / emite HTTP não-conforme
  (o bundle chega truncado por `curl`; íntegro por `Invoke-WebRequest`). Relevante para o
  cliente HTTP do adapter — precisa tolerar resposta parcial/malformada.

## 4. Módulo facial — `192.168.2.188`

> Tudo abaixo é do **webserver de administração** (porta 80). O canal de dados de produção é
> outro: WebSocket `/pub/chat` na porta 7792, documentado em `docs/vendor/topdata/PROTOCOLO-FACIAL.md`.
> O `POST /api {cmd}` visto aqui é da UI de admin, **não** é o protocolo `/pub/chat`.

- **UI:** página jQuery clássica (não SPA). Firmware OEM de origem chinesa, rebrand.
- **API de admin:** endpoint único **`POST /api`**, `Content-Type: application/json`, envelope por comando:
  ```
  requisição:  { "cmd": "<comando>", ...campos }
  resposta:    { "ret": "<comando>", "sn": "<serial>", "result": <bool>, "reason": <int>, "msg": "<texto>" }
  ```
- **Comandos legíveis sem sessão:** `login`, `getlang`. Demais (person, face, record, device,
  config) exigem sessão — não enumerados.
- **`getlang` (leitura, sem auth) respondeu:** `{ ret:"getlang", sn:"AYTI11108174", result:true, lang:"Brazilian" }`
  — **serial `AYTI11108174` bate** com o registrado em `PROTOCOLO-FACIAL.md` §"reg" e no `STATUS.md`.
- **Login:** `{ cmd:"login", username, password, rememberMe }`. Erros distinguem
  `reason:1` (usuário) de `reason:2` (senha), com `msg` textual (`"password error"`,
  `"password empty"`). O usuário **`admin` existe** (todas as tentativas falharam por senha,
  nunca por usuário).
- **`base` da API:** variável JS `debugserver`; em produção vem `''` (host relativo → `POST
  http://192.168.2.188/api`). O valor de debug embutido no firmware é `http://192.168.0.22`
  (rede de desenvolvimento do fornecedor, não da Arena).

## 5. Credenciais — estado atual

**Inner (`.187`): DESTRAVADO.** Credencial **`ADMIN` / `C@traca`** confirmada (login `200 OK`,
15/08/2026). O 401 anterior era erro de método, não de senha: o app **cifra** usuário e senha
antes de enviar (§3), e eu mandava em texto puro. Com a cifra reproduzida, a UI de admin do Inner
está acessível por API — a config local (18 dígitos, lista de acesso) é ajustável.

**Facial (`.188`): ainda não confirmado.** O usuário `admin` existe (§4), mas `C@traca` foi
recusado com `password error`. O facial é firmware OEM diferente (não usa a cifra do Inner); pode
ter senha própria. Testar `ADMIN`/`C@traca` na UI do facial diretamente resolve — pendente.

> **O que a credencial NÃO altera.** O canal SDK de produção (WebSocket 7792 / DLL 3570) **não**
> usa a senha do webserver — é outro plano (§0). A integração do ArenaHub não depende dela; serve
> para config pela UI web.

Nenhum bruteforce foi executado — a senha veio do PI. Conteúdo de biometria/lista de acesso do
Inner **não** foi lido, mesmo com acesso: pode conter dado de aluno (regra do projeto).

## 6. Como isto se relaciona com a documentação

Nenhum ponto abaixo contradiz ADR/spec/manual. São confirmações e um fato operacional novo.

1. **Confirma os manuais, não os contraria.** As portas do canal SDK (`7792` facial, `3570`
   catraca) aparecerem fechadas no scan é **coerente** com a arquitetura documentada: o facial é
   cliente WebSocket que disca para o edge-agent, e a catraca só fala por DLL binária que abre a
   conexão. Ver §0 e `docs/vendor/topdata/`.

2. **Confirma identidade e inventário ao vivo:** serial `AYTI11108174`, IP `192.168.2.188`,
   idioma "Brazilian" no facial — batem com `PROTOCOLO-FACIAL.md` e `STATUS.md`. A catraca no
   `.187` é Inner (UI Topdata), reconciliando com ADR-009/ADR-010 e as fatias F1–F5.

3. **Fato operacional novo — o webserver de admin (porta 80) tem senha de fábrica trocada nos
   dois.** Isto **não** está nos manuais (que tratam do canal SDK, não da UI de admin) e é
   relevante para a operação: qualquer tarefa que dependa da UI de admin (configurar os
   `use_logphoto`/`stranger_photo` do facial, ajustar dígitos do leitor, gestão local de lista de
   acesso) precisa da senha atual — que o PI não tem. Ver §5.

4. **Sobre a configuração de dígitos do leitor (`PROTOCOLO-FACIAL.md` §enrollid).** O manual exige
   o leitor em **18 dígitos** no menu para o `enrollid` de 12 dígitos ser aceito, e o `STATUS.md`
   lista isso como item que trava a F2. Esse ajuste é feito **pela UI de admin** — logo, depende
   da senha trocada. **Ponte entre os dois documentos:** sem a credencial do webserver, o item "18
   dígitos" pode não ter como ser conferido/ajustado remotamente.

## 7. O que falta

**Depende da credencial do webserver de admin (§5):**

- confirmar/ajustar o leitor em **18 dígitos** (trava a F2 — `STATUS.md`, `PROTOCOLO-FACIAL.md`);
- garantir `use_logphoto:0` e `stranger_photo:0` até decisão do PI (regra de arquitetura nº 7 /
  ADR-008);
- inspecionar config local (lista de acesso, biometrias) pela UI.

**Depende da POC do MVP 0 (ADR-010) — não desta credencial, mas do canal SDK:**

- subir o servidor WebSocket do `edge-agent` e observar o leitor conectar (`reg` → resposta),
  cadastro/evento (`setuserinfo`/`sendlog`) — `PROTOCOLO-FACIAL.md`;
- exercitar o `EasyInner.dll` via bridge Windows: comando de liberação e confirmação de giro —
  `PROTOCOLO-CATRACA.md`;
- medir latência ponta a ponta (facial → decisão → giro).

## 8. Leitura de gate do MVP 0 — recomendação `GO_WITH_CONSTRAINTS`

> **Isto é recomendação de campo, não a decisão.** O gate de saída do `MVP-00` §15 exige
> assinatura do responsável técnico **e** operacional (`M0-AC-010`) e evidência auditável de
> `M0-AC-001..008`. Esta seção prepara essa decisão; **não a substitui.** O gate fecha quando a
> POC física rodar e o PI assinar.

**Por que `GO_WITH_CONSTRAINTS` e não `GO`:** o código das quatro fatias técnicas está entregue e
verde em simulador (F1, F2, F3, F4 — ver `DEVELOPMENT.md` §"MVP 0"). Isso é condição necessária,
não suficiente: o PRD é explícito que *"demonstração isolada sem logs, cenários de falha ou passos
reproduzíveis não é aceite"* (§2). A POC **física** — cadastrar/reconhecer/girar na catraca real
com latência medida (`M0-AC-001..005`) — **não rodou**, e não pode rodar hoje sem cumprir os gates
de entrada.

**Estado por fatia, cruzado com o campo:**

| fatia | código | evidência real | o que falta para o aceite |
|---|---|---|---|
| F1 Bancada | ✅ entregue | ✅ simulador em CI | — |
| F2 Facial | ✅ adapter real | ❌ | consentimento; leitor em 18 dígitos (credencial de admin, §5); `use_logphoto`/`stranger_photo=0` |
| F3 Catraca | 🟡 adapter real | ❌ | ponte Windows (ADR-010, forma decidida pelo PI); janela combinada + parada de emergência; rede isolada/legado desligado |
| F4 Offline | ✅ entregue | ✅ regra pura, testável sem HW | — (fechou sozinha; `M0-AC-006/007` evidenciáveis por simulador) |
| F5 Decisão | — | — | depende de F1–F4 com evidência física |

**Restrições que o campo impõe ao MVP 1 (o que "with constraints" carrega):**

1. **A bancada é a unidade em produção, não um laboratório.** Confirmado ao vivo: catraca, facial
   e o edge-agent legado `.106` na mesma rede, com o legado **operando** (§2.2, §2.3). A POC exige
   **janela combinada** com o legado desligado, ou uma **rede isolada** montada — pré-condição do
   PI, não de engenharia.
2. **Coexistência com o sistema legado.** Há um edge-agent Topdata já comandando os equipamentos
   (`.106`). O ArenaHub precisa de uma decisão de **substituição ou convivência** — dois cérebros
   na mesma catraca é risco operacional.
3. **Credencial de admin dos equipamentos.** Sem ela, parte da config exigida pela F2 (18 dígitos,
   flags de foto) não é ajustável (§5, §7).
4. **IP do Inner é DHCP** — reserva/IP fixo recomendado para o piloto (§2.1).

**Pré-condições do PI para destravar a POC física (nenhuma é código):**

- [ ] consentimento dos participantes do teste (regra de arquitetura nº 7 / ADR-008 / gate §4);
- [ ] rede isolada **ou** janela combinada com o legado `.106` desligado;
- [ ] procedimento de parada de emergência da catraca definido (gate §4);
- [ ] forma da ponte Windows decidida (ADR-010);
- [ ] credencial de admin dos dois equipamentos, ou reset físico assumido.

Cumpridas, roda-se `pnpm --filter edge-agent lab:run` na janela combinada, coletam-se
`M0-AC-001..008`, e o gate §15 pode ser assinado.

## 9. Teste de giro da catraca (15/08/2026) — ponte pronta, giro bloqueado por config

Com o PI presente e a catraca liberada, tentou-se o **giro real** via a ponte EasyInner nativa
(processo .NET x86 + `EasyInner.dll`, ver `apps/edge-agent/native/easyinner-bridge/`). Resultado:
**a ponte funciona; o giro não ocorreu por uma razão de ambiente, não de código.**

**O que funcionou (comprovado):**
- a ponte C# compila x86 e **carrega a `EasyInner.dll` sem GPF** (o smoke `ping` retorna 2 =
  porta não aberta, prova de que a DLL carregou e o loop stdio responde);
- o protocolo stdio Node↔C# funciona (3 testes unitários verdes);
- `AbrirPortaComunicacao(3570)` abre a escuta local; a ponte fica em `LISTEN` na 3570;
- a sequência de inicialização online (`ConfigurarInnerOnLine` + `ConfigurarAcionamento1` +
  `ConfigurarLeitor1/2`) foi implementada conforme o exemplo oficial `FrmOnlineController.cs`.

**O que bloqueou (diagnóstico ao vivo):**
- todo comando dirigido ao Inner 1 (`versao`, `liberar`, `acionar-rele`) retornou `1` (erro) e a
  versão de firmware voltou `0.00.00` — **ninguém do outro lado**;
- `Get-NetTCPConnection -LocalPort 3570` mostrou a ponte em `LISTEN` mas **nenhuma conexão
  `ESTABLISHED` com a `.187`** — a catraca **nunca discou** para a ponte;
- a config da catraca, lida via API autenticada (`GET /info`, credencial `ADMIN`/`C@traca`),
  confirmou: **`"ipServer":"192.168.2.106"`** — a catraca continua apontada para o servidor
  legado, não para o edge-agent.

**Causa raiz:** no EasyInner **o PC é servidor e a catraca é cliente** — a catraca disca para o
`ipServer` configurado nela. Enquanto esse valor for `.106`, a catraca fala só com o legado; a
ponte abre a porta e espera em vão. Isto **confirma ao vivo** o achado da §2.2/§2.3: a catraca tem
**um dono por vez**, e trocar de dono é um passo de **cutover**, não de teste.

O firewall desta máquina (perfil **Público**) também bloqueava entrada na 3570; foi aberto com
regra `Inbound TCP 3570` (admin). Necessário, mas não suficiente — o bloqueio real é o `ipServer`.

**Procedimento de cutover (para a POC física / migração):**
1. desligar o software legado no `.106`;
2. na catraca, mudar `ipServer` de `192.168.2.106` para o IP do edge-agent (ex.: `192.168.2.189`),
   mantendo `porta 3570`, e reiniciar/reconectar a catraca;
3. abrir a 3570 de entrada no firewall do edge-agent;
4. subir a ponte e observar a catraca discar (`ESTABLISHED` na 3570); então `liberar` gira.

> **Nesta sessão o passo 2 NÃO foi executado** — o PI optou por **não alterar a config da catraca
> em produção**. Decisão correta: mudar `ipServer` tira a catraca do controle do legado, e é um
> ato de cutover planejado, não de teste ad hoc. **A ponte fica pronta e comprovada; o giro real
> aguarda a janela de cutover.**

**Dados novos lidos via API autenticada** (`/info`, `/configuracaoacesso`):
- `numeroSerial: 0247000797`, `versaoFw: 7.05`, `numeroInner: 1`, `macInner: 00:18:E2:09:62:A2`,
  `bioQuantidade: 0`, `moduloBio: false`;
- `acionamento1: 8` (= `CATRACA_LIBERADA_DOIS_SENTIDOS`), `tempoAcionamento1: 5`,
  `configLeitor1: 4`, `numeroDigitosCartao: 14`.

**O facial (`.188`) está no mesmo bloqueio — e mais fechado que a catraca.**
- Etiqueta física confirmou: **modelo `F4+`**, "AI Face Identification", serial `AYTI11108174`,
  patrimônio `255003182`, leitor de cartão interno ID (125 kHz), DC12V. O `F4+` é coberto por
  `PROTOCOLO-FACIAL.md`.
- Com o legado desligado, subiu-se um **servidor WebSocket na 7792** nesta máquina (a arquitetura
  do facial é a mesma: o leitor disca para o servidor). Em 20 s de observação, **o facial não
  discou** — aponta para o servidor configurado nele (presumível `.106`), não para o edge-agent.
- Diferente da catraca, **não há login no facial**: `ADMIN`/`C@traca` e defaults foram recusados
  (`password error`); o usuário `admin` existe, a senha é própria e desconhecida. Logo **não se
  lê nem se altera** a config de rede do facial pela API.
- **Conclusão:** catraca e facial têm o mesmo impasse — apontam para o servidor legado, e mudar
  isso é **cutover**, não teste. O lado ArenaHub está pronto para os dois (ponte da catraca
  construída; servidor WebSocket do facial já existe no edge-agent); o que falta é o passo de
  cutover, decisão operacional do PI.

---

*Artefato de campo, datado. Vale para o estado da rede em 15/08/2026; estendido quando houver
credencial de admin e/ou a POC do MVP 0 rodar.*
