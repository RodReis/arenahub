'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from './plans.module.css';

import { cadastrarPlano, type EstadoDoPlano } from '../../actions/membership';

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

const DIAS = [
  { valor: '1', rotulo: 'Segunda' },
  { valor: '2', rotulo: 'Terça' },
  { valor: '3', rotulo: 'Quarta' },
  { valor: '4', rotulo: 'Quinta' },
  { valor: '5', rotulo: 'Sexta' },
  { valor: '6', rotulo: 'Sábado' },
  { valor: '7', rotulo: 'Domingo' },
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
 * Cadastro de plano — Slice 1.2.
 *
 * O plano é ONDE e QUANDO o acesso vale: unidades e janelas de horário. Ele
 * **não tem preço** — `Plan` não carrega valor monetário no MVP 1, e dinheiro
 * entra só no MVP 2 (F12), com tipo inteiro em centavos. Um campo de preço
 * aqui seria promessa que o servidor não cumpre.
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
    <form className={estilos['formulario']} action={acao}>
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
