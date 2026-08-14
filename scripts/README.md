# `scripts/` — guardas do repositório

Dois scripts, ambos com o mesmo propósito: **fazer o repositório falhar em vez de mentir**.

## `run-task.mjs` — comando que não roda nada, falha

Envolve `turbo run <task>`. Se nenhum workspace declarar a task, falha com exit 1 e diz o que
fazer.

**Por que existe.** `turbo run test` num repositório onde ninguém declara `test` imprime
`WARNING No tasks were executed` e **sai com código 0**. O aviso passa despercebido; o código de
saída, não. Quem lê o código de saída é o CI — que no nosso processo substitui o aceite humano no
merge (`CLAUDE.md` → *Ciclo de vida de uma fatia*, passo 3).

> Comando que passa sem executar nada é pior que comando ausente: o ausente quebra na hora, o
> mentiroso quebra a confiança no sinal verde.

O Turbo 2.10 não tem flag para isso — verificado em `turbo run --help`.

### A verificação usa `--dry=json`, nunca a saída humana

Três coisas que custaram descoberta, todas por teste:

**A saída humana é colorida.** Sob `FORCE_COLOR=1` — que muitos runners de CI ligam por padrão —
a linha vira `\x1b[1m Tasks:    \x1b[32m\x1b[1m0 successful\x1b[0m, 0 total\x1b[0m`, e qualquer
regex sobre texto falha. A primeira versão deste guarda lia texto e **passava batido exatamente no
CI**, que é onde ele mais importa. O `--dry=json` não leva ANSI.

**`dev` é persistente.** Entrega o terminal e só volta no Ctrl+C, então não há saída para
inspecionar depois. Como a verificação agora vem sempre antes de rodar, ele deixou de ser caso
especial.

**`--dry=json` lista a task mesmo quando ela não existe**, marcando `command: "<NONEXISTENT>"`.
Contar o array não basta — o guarda filtra por comando real.

**O binário chamado é `node_modules/.bin/turbo`, não `pnpm turbo`.** O pnpm escreve avisos no
stdout (`WARN Unsupported engine`) e contamina o JSON.

## `check-port.mjs` — porta ocupada, falha

Tenta abrir a porta. Se estiver ocupada, falha em vez de procurar outra.

**Por que existe.** `CLAUDE.md` → *Regras de trabalho*: **API `3344` é fixa — se ocupada, falha em
vez de trocar**. Framework que cai sozinho na porta seguinte produz o pior cenário: dois processos
servindo, o operador falando com um e lendo o log do outro.

> Colisão vira decisão registrada, nunca troca silenciosa.

Ainda não há API. O guarda existe para que, quando ela nascer, o `dev` dela comece assim:

```jsonc
{
  "scripts": {
    "dev": "node ../../scripts/check-port.mjs 3344 api && nest start --watch"
  }
}
```

### Testa as duas interfaces, não só o loopback

`listen(porta, '127.0.0.1')` sozinho **não detecta** processo escutando em `0.0.0.0` — o bind no
loopback tem sucesso mesmo com a porta ocupada. E `0.0.0.0` é o padrão do Docker e da maioria dos
serviços, ou seja, o caso mais comum de colisão numa máquina de desenvolvimento.

A primeira versão testava só o loopback: o guarda existia e não guardava nada. Agora testa as
duas.

Só a `3344` tem esse tratamento. As portas do `docker-compose` são configuráveis por `.env` de
propósito — ver `infra/docker/README.md`.

## `guardas.test.mjs` — os dois guardas têm teste

```
pnpm test:guardas
```

Seis casos, sem framework — os guardas nascem antes do runner de teste existir (`#44` vem antes do
`#46`/`#47`).

**Dois deles são regressão de defeito real:** a detecção sob `FORCE_COLOR=1` e a porta ocupada em
`0.0.0.0`. Ambos passaram batido na primeira versão e só apareceram na revisão. Estão aqui para
não voltarem.

Quando o Jest/Vitest entrar (`#46` em diante), estes casos migram para lá.
