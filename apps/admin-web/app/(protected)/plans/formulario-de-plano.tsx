'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from './plans.module.css';

import { cadastrarPlano, type EstadoDoPlano } from '../../actions/membership';
import { paraCentavos } from '../../../src/billing/dinheiro';

interface Unidade {
  id: string;
  name: string;
}

interface Props {
  unidades: Unidade[];
}

interface LinhaDeJanela {
  chave: number;
  unidade: string;
  dia: string;
  inicio: string;
  fim: string;
}

const ESTADO_INICIAL: EstadoDoPlano = {};

// `valor` é o eixo do motor de decisão: 0 = domingo ... 6 = sábado (#129).
// A ordem de exibição começa na segunda porque é assim que a recepção lê uma
// grade de horário -- o domingo fica no fim da lista, com o valor 0.
const DIAS = [
  { valor: '1', rotulo: 'Segunda' },
  { valor: '2', rotulo: 'Terça' },
  { valor: '3', rotulo: 'Quarta' },
  { valor: '4', rotulo: 'Quinta' },
  { valor: '5', rotulo: 'Sexta' },
  { valor: '6', rotulo: 'Sábado' },
  { valor: '0', rotulo: 'Domingo' },
];

function BotaoDePlano() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-plano">
      {pending ? 'Criando…' : 'Criar plano'}
    </Button>
  );
}

/**
 * Cadastro de plano — Slice 1.2, com preço obrigatório desde a F53.
 *
 * O plano é ONDE e QUANDO o acesso vale: unidades e janelas de horário. O
 * preço define QUANTO — a API exige `amountMinor` desde o commit f1a8b9b:
 * plano sem preço não pode existir nem por um instante (decisão do PI,
 * 24/08/2026), porque `plan_prices` sem linha vigente é o que barrava a
 * cobrança do balcão.
 *
 * As janelas nascem como linhas de formulário repetidas: `getAll` preserva a
 * ordem, e é isso que amarra dia, início e fim da mesma linha.
 */
export function FormularioDePlano({ unidades }: Props) {
  const [estado, acao] = useActionState(cadastrarPlano, ESTADO_INICIAL);
  // Erro vira TOAST -- CLAUDE.md: "sempre usar Toast para: Info, Warn e
  // error". O toast ja carrega `role="alert"`, entao o anuncio ao leitor de
  // tela nao regride com a saida do `<p role="alert">`.
  useToastDeErro(estado.erro, 'error', 'erro-do-plano');

  /*
   * Erro de preco fica LOCAL, nao viaja ate a Server Action.
   *
   * F53: plano sem preco nao pode existir. `required` nativo nao serve --
   * este campo nao esta escondido, mas a conversao de reais para centavos
   * (`paraCentavos`) so acontece aqui, e o formato invalido ("15,005") o
   * navegador nao pega sozinho. Barrar em JS antes do envio evita o
   * round-trip e diz exatamente qual foi o problema.
   */
  const [erroDoPreco, setErroDoPreco] = useState<string | null>(null);

  const [linhas, setLinhas] = useState<LinhaDeJanela[]>([
    {
      chave: 1,
      unidade: unidades[0]?.id ?? '',
      dia: '1',
      inicio: '06:00',
      fim: '22:00',
    },
  ]);

  const [proximaChave, setProximaChave] = useState(2);

  const adicionar = (): void => {
    setLinhas([
      ...linhas,
      {
        chave: proximaChave,
        unidade: unidades[0]?.id ?? '',
        dia: '1',
        inicio: '06:00',
        fim: '22:00',
      },
    ]);
    setProximaChave(proximaChave + 1);
  };

  const remover = (chave: number): void => {
    setLinhas(linhas.filter((linha) => linha.chave !== chave));
  };

  const alterar = (chave: number, campo: keyof LinhaDeJanela, valor: string): void => {
    setLinhas(
      linhas.map((linha) => (linha.chave === chave ? { ...linha, [campo]: valor } : linha)),
    );
  };

  /**
   * Barra sem preco valido, ou envia -- nunca os dois.
   *
   * Mesmo formato de `formulario-de-cadastro.tsx`: a validacao ENVOLVE a
   * action, porque `preventDefault` de `onSubmit` nao cancela o envio via
   * `action` (sao caminhos alternativos, nao encadeados).
   */
  const enviar = (formulario: FormData): void => {
    const valorDoCampo = formulario.get('amountMinor');
    const digitado = (typeof valorDoCampo === 'string' ? valorDoCampo : '').trim();

    if (digitado === '') {
      setErroDoPreco('Informe o preço do plano.');
      return;
    }

    const centavos = paraCentavos(digitado);

    if (centavos === null || centavos <= 0) {
      setErroDoPreco('Preço inválido — use até duas casas decimais, por exemplo 150,00.');
      return;
    }

    setErroDoPreco(null);
    acao(formulario);
  };

  if (unidades.length === 0) {
    return (
      <p data-testid="sem-unidades">
        Nenhuma unidade cadastrada. <a href="/units">Cadastre uma unidade</a> antes de criar
        planos.
      </p>
    );
  }

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="plano-criado">
        <p>
          Plano <strong>{estado.sucesso.name}</strong> criado.
        </p>
        <p>
          <a href="/plans">Ver a lista de planos</a>
        </p>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={enviar}>
      <Field
        id="nome-do-plano"
        name="name"
        label="Nome do plano"
        defaultValue={estado.valores?.name ?? ''}
        maxLength={120}
        required
        data-testid="campo-nome-do-plano"
      />

      <TextareaField
        id="descricao"
        name="description"
        label="Descrição"
        defaultValue={estado.valores?.description ?? ''}
        rows={2}
        maxLength={500}
      />

      {/*
        F53: plano sem preco nao pode existir -- a API recusa (`amountMinor`
        obrigatorio desde o commit f1a8b9b). `aria-required`, nunca
        `required` nativo: a validacao real mora na Server Action, em JS.
      */}
      <Field
        id="preco-do-plano"
        name="amountMinor"
        label="Preço"
        unit="R$"
        defaultValue={estado.valores?.amountMinor ?? ''}
        inputMode="decimal"
        hint="Em reais, com até duas casas — por exemplo 150,00."
        {...(erroDoPreco ? { error: erroDoPreco } : {})}
        aria-required="true"
        data-testid="campo-preco-do-plano"
      />

      <fieldset className={estilos['grupo']}>
        <legend>Unidades onde o plano vale</legend>

        {unidades.map((unidade) => (
          <label key={unidade.id} className={estilos['marcador']}>
            <input
              type="checkbox"
              name="gymUnitIds"
              value={unidade.id}
              defaultChecked={unidade.id === unidades[0]?.id}
            />
            {unidade.name}
          </label>
        ))}
      </fieldset>

      <fieldset className={estilos['grupo']}>
        <legend>Janelas de horário</legend>

        {/*
          Sem janela não há plano: a API exige ao menos uma. O padrão já vem
          preenchido com segunda 06:00–22:00 porque o caso comum é esse, e um
          formulário que começa vazio faz a operadora montar sete linhas à mão.
        */}
        <p role="note">
          O acesso vale só dentro destas janelas. Use 24:00 para indicar o fim do dia.
        </p>

        <table className={estilos["janelas"]} data-testid="tabela-de-janelas">
          <caption>Uma linha por dia e faixa de horário</caption>
          <thead>
            <tr>
              <th scope="col">Unidade</th>
              <th scope="col">Dia</th>
              <th scope="col">Início</th>
              <th scope="col">Fim</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.chave} data-testid={`janela-${linha.chave}`}>
                <td>
                  <select
                    name="janelaUnidade"
                    value={linha.unidade}
                    onChange={(evento) => alterar(linha.chave, 'unidade', evento.target.value)}
                    aria-label="Unidade da janela"
                  >
                    {unidades.map((unidade) => (
                      <option key={unidade.id} value={unidade.id}>
                        {unidade.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    name="janelaDia"
                    value={linha.dia}
                    onChange={(evento) => alterar(linha.chave, 'dia', evento.target.value)}
                    aria-label="Dia da semana"
                  >
                    {DIAS.map((dia) => (
                      <option key={dia.valor} value={dia.valor}>
                        {dia.rotulo}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="time"
                    name="janelaInicio"
                    value={linha.inicio}
                    onChange={(evento) => alterar(linha.chave, 'inicio', evento.target.value)}
                    aria-label="Hora de início"
                  />
                </td>
                <td>
                  <input
                    type="time"
                    name="janelaFim"
                    value={linha.fim}
                    onChange={(evento) => alterar(linha.chave, 'fim', evento.target.value)}
                    aria-label="Hora de fim"
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => remover(linha.chave)}
                    disabled={linhas.length === 1}
                    data-testid={`remover-janela-${linha.chave}`}
                  >
                    Remover
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Button
          type="button"
          variant="outline"
          onClick={adicionar}
          data-testid="adicionar-janela"
        >
          Adicionar janela
        </Button>
      </fieldset>

      <BotaoDePlano />
    </form>
  );
}
