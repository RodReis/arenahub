'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import {
  ativarDesafio,
  criarDesafio,
  type EstadoDoDesafio,
  type TemplateDeDesafioDto,
} from '../../../actions/engagement';
import estilos from './desafios.module.css';

interface Unidade {
  readonly id: string;
  readonly name: string;
}

const ESTADO_INICIAL: EstadoDoDesafio = {};

/** Dias entre duas datas locais, inclusivo -- o mesmo calculo do dominio. */
function diasEntre(inicio: string, fim: string): number {
  const t0 = Date.parse(`${inicio}T00:00:00.000Z`);
  const t1 = Date.parse(`${fim}T00:00:00.000Z`);

  if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;

  return (t1 - t0) / 86_400_000 + 1;
}

/**
 * Desafios -- F34, Slice 5.5, ADR-048.
 *
 * A TELA MOSTRA O TETO ANTES DE ENVIAR, e essa e a decisao de desenho: a API
 * recusa meta acima do limite do modelo (`M5-BR-011`), mas descobrir isso so
 * depois de preencher tudo faria a secretaria adivinhar o numero por
 * tentativa. O aviso e informativo -- a RECUSA continua sendo do servidor,
 * porque validacao de cliente nao e guarda.
 */
export function PainelDeDesafios({
  modelos,
  unidades,
}: {
  readonly modelos: readonly TemplateDeDesafioDto[];
  readonly unidades: readonly Unidade[];
}) {
  const [estadoCriar, acaoCriar] = useActionState(criarDesafio, ESTADO_INICIAL);
  const [estadoAtivar, acaoAtivar] = useActionState(ativarDesafio, ESTADO_INICIAL);
  const [enviando, iniciarEnvio] = useTransition();

  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? '');
  const [unidadeId, setUnidadeId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [meta, setMeta] = useState('8');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');

  useToastDeErro(estadoCriar.erro, 'error', 'erro-ao-criar-desafio');
  useToastDeErro(estadoAtivar.erro, 'error', 'erro-ao-abrir-desafio');

  const modelo = modelos.find((m) => m.id === modeloId);

  /**
   * Teto da janela escolhida: semanas parciais contam como semana, igual ao
   * `Math.ceil` do dominio. Numero diferente aqui e la faria a tela prometer
   * o que o servidor recusa.
   */
  const teto = useMemo(() => {
    if (!modelo || !inicio || !fim || fim < inicio) return null;

    const dias = diasEntre(inicio, fim);

    if (dias <= 0 || dias > modelo.maxJanelaEmDias) return null;

    return Math.ceil(dias / 7) * modelo.maxSessoesPorSemana;
  }, [modelo, inicio, fim]);

  const janelaLongaDemais =
    modelo !== undefined && inicio !== '' && fim !== '' && fim >= inicio
      ? diasEntre(inicio, fim) > modelo.maxJanelaEmDias
      : false;

  const criado = estadoCriar.sucesso;

  if (modelos.length === 0) {
    return (
      <p data-testid="sem-modelos">
        Nenhum modelo de desafio está disponível. Modelos definem o limite de treinos por semana
        e são cadastrados junto com o catálogo do produto.
      </p>
    );
  }

  return (
    <div className={estilos['grade']}>
      <form
        className={estilos['bloco']}
        action={(dados) => {
          iniciarEnvio(() => {
            acaoCriar(dados);
          });
        }}
      >
        <h2>Novo desafio</h2>

        <SelectField
          id="modelo-do-desafio"
          name="templateVersionId"
          label="Modelo"
          value={modeloId}
          disabled={enviando}
          onChange={(evento) => setModeloId(evento.target.value)}
        >
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — até {m.maxSessoesPorSemana} treinos por semana
            </option>
          ))}
        </SelectField>

        <SelectField
          id="unidade-do-desafio"
          name="gymUnitId"
          label="Unidade"
          value={unidadeId}
          disabled={enviando}
          onChange={(evento) => setUnidadeId(evento.target.value)}
        >
          {/* Vazio = todas. A API trata string vazia como `null`. */}
          <option value="">Todas as unidades</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>

        <Field
          id="titulo-do-desafio"
          name="title"
          label="Título"
          value={titulo}
          maxLength={120}
          disabled={enviando}
          onChange={(evento) => setTitulo(evento.target.value)}
        />

        <div className={estilos['periodo']}>
          <Field
            id="inicio-do-desafio"
            name="startsOn"
            label="Início"
            type="date"
            value={inicio}
            disabled={enviando}
            onChange={(evento) => setInicio(evento.target.value)}
          />
          <Field
            id="fim-do-desafio"
            name="endsOn"
            label="Fim"
            type="date"
            value={fim}
            disabled={enviando}
            onChange={(evento) => setFim(evento.target.value)}
          />
        </div>

        <Field
          id="meta-do-desafio"
          name="targetValue"
          label="Meta (treinos no período)"
          type="number"
          min={1}
          value={meta}
          disabled={enviando}
          onChange={(evento) => setMeta(evento.target.value)}
        />

        {janelaLongaDemais && modelo ? (
          <p data-testid="janela-longa-demais" className={estilos['aviso']}>
            Este modelo permite no máximo {modelo.maxJanelaEmDias} dias de período.
          </p>
        ) : null}

        {teto !== null ? (
          <p data-testid="teto-da-janela" className={estilos['aviso']}>
            Neste período, a meta pode ir até {teto} treinos.
          </p>
        ) : null}

        <Button type="submit" disabled={enviando}>
          Criar desafio
        </Button>
      </form>

      <div className={estilos['bloco']}>
        <h2>Abrir inscrição</h2>

        {criado ? (
          <form
            className={estilos['resultado']}
            action={(dados) => {
              iniciarEnvio(() => {
                acaoAtivar(dados);
              });
            }}
          >
            <p data-testid="desafio-criado">
              <strong>{criado.titulo}</strong> foi criado e está fechado. Confira o período e a
              meta antes de abrir — depois de aberto, os alunos já podem se inscrever pelo totem.
            </p>

            <input type="hidden" name="challengeId" value={criado.id} />

            <Button type="submit" disabled={enviando}>
              Abrir inscrição
            </Button>

            {estadoAtivar.sucesso ? (
              <p data-testid="desafio-aberto">
                Inscrição aberta. O desafio já aparece no totem para os alunos da unidade
                escolhida.
              </p>
            ) : null}
          </form>
        ) : (
          <p data-testid="sem-desafio-criado">
            Crie um desafio ao lado para abrir a inscrição.
          </p>
        )}
      </div>
    </div>
  );
}
