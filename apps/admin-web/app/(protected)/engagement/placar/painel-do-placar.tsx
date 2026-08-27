'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, StateBadge, TenantDateTime, useToastDeErro } from '@arenahub/ui';

import {
  ajustarXp,
  gerarPlacar,
  publicarPlacar,
  type EstadoDoAjuste,
  type EstadoDoGerar,
  type EstadoDoPublicar,
  type SnapshotDto,
} from '../../../actions/engagement';
import estilos from './placar.module.css';

interface Unidade {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
}

const ESTADO_DO_GERAR: EstadoDoGerar = {};
const ESTADO_DO_PUBLICAR: EstadoDoPublicar = {};
const ESTADO_DO_AJUSTE: EstadoDoAjuste = {};

/**
 * Placar mensal e ajuste de XP -- F31, Task 11.
 *
 * SEM CAMPO DE EDICAO DE POSICAO OU DE MOVIMENTO, de proposito: o snapshot
 * publicado e imutavel (`M5-AC-007`) e o ledger e append-only (Task 1). O
 * unico jeito de corrigir e gerar (se ainda nao publicado) ou ajustar XP por
 * um movimento NOVO -- nunca reescrever o que ja existe.
 */
export function PainelDoPlacar({ unidades }: { readonly unidades: readonly Unidade[] }) {
  return (
    <div className={estilos['grade']}>
      <BlocoDeGeracao unidades={unidades} />
      <BlocoDeAjuste />
    </div>
  );
}

/** Gera o snapshot do mes/unidade escolhidos e, se DRAFT, permite publicar. */
function BlocoDeGeracao({ unidades }: { readonly unidades: readonly Unidade[] }) {
  const [estadoGerar, acaoGerar] = useActionState(gerarPlacar, ESTADO_DO_GERAR);
  const [estadoPublicar, acaoPublicar] = useActionState(publicarPlacar, ESTADO_DO_PUBLICAR);
  const [enviando, iniciarEnvio] = useTransition();

  const [unidadeId, setUnidadeId] = useState(unidades[0]?.id ?? '');
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  // Fuso da unidade ESCOLHIDA -- nunca um default fixo (ver o comentario de
  // `TenantDateTime`: "sem default, quem chama e obrigado a dizer de onde
  // tirou o fuso"). `undefined` só quando não há nenhuma unidade na lista.
  const fusoDaUnidade = unidades.find((u) => u.id === unidadeId)?.timezone;

  /*
   * O snapshot exibido e o da acao mais recente que devolveu um -- gerar
   * substitui o que publicar tinha mostrado, e vice-versa. `useEffect`
   * porque o erro/sucesso de `useActionState` chega como VALOR NOVO no
   * meio de um render, nao como evento com `onSuccess`.
   */
  const [snapshot, setSnapshot] = useState<SnapshotDto | undefined>(undefined);

  useEffect(() => {
    if (estadoGerar.snapshot) setSnapshot(estadoGerar.snapshot);
  }, [estadoGerar.snapshot]);

  useEffect(() => {
    if (estadoPublicar.snapshot) setSnapshot(estadoPublicar.snapshot);
  }, [estadoPublicar.snapshot]);

  useToastDeErro(estadoGerar.erro, 'error', 'erro-do-gerar');
  useToastDeErro(estadoPublicar.erro, 'error', 'erro-do-publicar');

  function gerar() {
    const formulario = new FormData();
    formulario.set('gymUnitId', unidadeId);
    formulario.set('mes', mes);
    iniciarEnvio(() => acaoGerar(formulario));
  }

  function publicar() {
    if (!snapshot) return;
    const formulario = new FormData();
    formulario.set('snapshotId', snapshot.id);
    iniciarEnvio(() => acaoPublicar(formulario));
  }

  return (
    <section aria-labelledby="titulo-geracao" className={estilos['bloco']}>
      <h2 id="titulo-geracao">Gerar e publicar</h2>

      <SelectField
        id="unidade-do-placar"
        label="Unidade"
        value={unidadeId}
        disabled={enviando}
        onChange={(evento) => setUnidadeId(evento.target.value)}
      >
        {unidades.map((unidade) => (
          <option key={unidade.id} value={unidade.id}>
            {unidade.name}
          </option>
        ))}
      </SelectField>

      <Field
        id="mes-do-placar"
        label="Mês"
        type="month"
        value={mes}
        disabled={enviando}
        onChange={(evento) => setMes(evento.target.value)}
        data-testid="mes-do-placar"
      />

      <Button
        type="button"
        disabled={unidadeId === '' || mes === '' || enviando}
        onClick={gerar}
        data-testid="gerar-placar"
      >
        {enviando ? 'Gerando…' : 'Gerar placar'}
      </Button>

      {snapshot ? (
        <div className={estilos['resultado']} data-testid="snapshot-gerado">
          <StateBadge machine="rankingSnapshot" state={snapshot.status} />

          {snapshot.status === 'WITHHELD' ? (
            <p data-testid="aviso-withheld">
              Este mês ficou <strong>retido</strong>: a coorte de alunos elegíveis não alcançou o
              mínimo configurado para o tenant. Isso não é um erro — é a política de privacidade
              funcionando, para não expor XP de um grupo pequeno demais para preservar o
              anonimato. Não há o que publicar até o mês reunir mais participantes.
            </p>
          ) : null}

          {snapshot.status === 'DRAFT' ? (
            <>
              <p>
                {snapshot.entries.length} aluno(s) classificado(s). Publicar é definitivo — não
                há como reverter ou gerar de novo depois.
              </p>
              <Button
                type="button"
                disabled={enviando}
                onClick={publicar}
                data-testid="publicar-placar"
              >
                {enviando ? 'Publicando…' : 'Publicar placar'}
              </Button>
            </>
          ) : null}

          {snapshot.status === 'PUBLISHED' && fusoDaUnidade !== undefined ? (
            <p data-testid="placar-publicado">
              Publicado em{' '}
              <TenantDateTime iso={snapshot.publishedAt} timeZone={fusoDaUnidade} />. Este placar
              é imutável — gerar de novo o mesmo mês cria uma tentativa nova, mas este que já foi
              publicado nunca é reescrito.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Ajuste manual de XP -- sempre um movimento NOVO, nunca edição do ledger. */
function BlocoDeAjuste() {
  const [estado, acao] = useActionState(ajustarXp, ESTADO_DO_AJUSTE);
  const [studentId, setStudentId] = useState('');
  const [pontos, setPontos] = useState('');
  const [motivo, setMotivo] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useToastDeErro(estado.erro, 'error', 'erro-do-ajuste');

  useEffect(() => {
    // Sucesso: limpa o formulario E sorteia uma chave nova -- reenviar com a
    // MESMA chave depois de um ajuste concluido seria a mesma correcao de
    // novo, e a chave unica do ledger recusaria silenciosamente (P2002 vira
    // sucesso idempotente no backend), fazendo parecer que nada aconteceu.
    if (estado.sucesso) {
      setPontos('');
      setMotivo('');
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [estado.sucesso]);

  const podeEnviar = studentId.trim() !== '' && pontos.trim() !== '' && motivo.trim() !== '';

  return (
    <section aria-labelledby="titulo-ajuste" className={estilos['bloco']}>
      <h2 id="titulo-ajuste">Ajustar XP</h2>

      <p>
        Não existe edição de movimento: todo ajuste grava um lançamento novo no extrato do
        aluno, com o motivo explicado. O lançamento original nunca é apagado.
      </p>

      <form action={acao}>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <Field
          id="aluno-do-ajuste"
          label="Identificador do aluno"
          name="studentId"
          value={studentId}
          onChange={(evento) => setStudentId(evento.target.value)}
          data-testid="aluno-do-ajuste"
        />

        <Field
          id="pontos-do-ajuste"
          label="Pontos"
          name="pontos"
          type="number"
          value={pontos}
          onChange={(evento) => setPontos(evento.target.value)}
          hint="Positivo concede, negativo estorna."
          data-testid="pontos-do-ajuste"
        />

        <Field
          id="motivo-do-ajuste"
          label="Motivo"
          name="motivo"
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          hint="Obrigatório — este texto fica anexado ao lançamento, para sempre."
          data-testid="motivo-do-ajuste"
        />

        <BotaoDeAjuste podeEnviar={podeEnviar} />
      </form>

      {estado.sucesso ? (
        <p role="status" data-testid="ajuste-registrado">
          Ajuste registrado no extrato do aluno.
        </p>
      ) : null}
    </section>
  );
}

function BotaoDeAjuste({ podeEnviar }: { readonly podeEnviar: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={!podeEnviar || pending} data-testid="confirmar-ajuste">
      {pending ? 'Registrando…' : 'Registrar ajuste'}
    </Button>
  );
}
