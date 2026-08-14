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

### Duas particularidades que custaram descoberta

**`dev` é persistente.** Entrega o terminal e só volta no Ctrl+C, então não dá para inspecionar a
saída depois de rodar. O guarda dele vem **antes**, via `turbo run dev --dry=json`.

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

Só a `3344` tem esse tratamento. As portas do `docker-compose` são configuráveis por `.env` de
propósito — ver `infra/docker/README.md`.
