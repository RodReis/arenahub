'use client';

import { useActionState, useId, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Ausente, Field, StateBadge, useToastDeErro } from '@arenahub/ui';

import {
  confirmarSessao,
  descartarSessao,
  revisarCampo,
  type EstadoDaConfirmacao,
  type EstadoDaRevisao,
  type EstadoDoDescarte,
} from '../../../../../../actions/assessment-imports';
import {
  confiancaLegivel,
  faixaLegivel,
  rotuloDeTipo,
  valorLegivel,
} from '../../../../../../../src/health/formatar';
import estilos from './sessao.module.css';

/**
 * Revisao campo a campo de uma sessao multiarquivo -- rebuild multiarquivo.
 *
 * Colunas do `DS-PAINEL.md` §8.4 + mock do PI: Campo · Valor extraído ·
 * Faixa de referência · Origem · Confiança · Leitura.
 *
 * As DUAS regras de UI que carregam significado de produto (brief):
 *
 *   1. Campo CONCORDANTE colapsa numa linha so, com selo das origens.
 *      Campo DIVERGENTE nunca colapsa: aparece em DUAS linhas agrupadas e
 *      visualmente distintas, com radio SEM `defaultChecked` -- escolher no
 *      lugar do avaliador e o erro exato que este design existe para evitar.
 *   2. Ausencia e SEMPRE `<Ausente />` (travessao), nunca `0` -- zero seria
 *      uma medicao real de zero (INV-104).
 *
 * O botao Confirmar fica DESABILITADO enquanto `podeConfirmar.pronta` for
 * falso, e o MOTIVO aparece como texto ao lado -- botao desabilitado sem
 * explicacao e beco sem saida para quem usa a tela.
 */

export interface CampoDaLinha {
  readonly id: string;
  readonly type: string;
  readonly extractedValue: number | null;
  readonly extractedUnit: string | null;
  readonly confidence: number | null;
  readonly referenceMin: number | null;
  readonly referenceMax: number | null;
  readonly sourceLabel: string | null;
  readonly state: string;
  readonly leitura: 'BELOW' | 'WITHIN' | 'ABOVE' | 'AT_LIMIT' | 'UNKNOWN';
  /**
   * Import dono deste campo -- a API de sessao nao devolve isso por campo
   * (so por arquivo); a `page.tsx` resolve por `sourceLabel` antes de montar
   * esta lista. `undefined` quando a resolucao falha (rotulo repetido entre
   * arquivos, ou campo sem rotulo): o formulario ainda funciona, so nao sabe
   * A QUAL arquivo mandar o descarte do concorrente.
   */
  readonly importId: string | undefined;
}

export interface LinhaDeRevisao {
  readonly type: string;
  readonly concordante: boolean;
  readonly origens: readonly string[];
  readonly campos: readonly CampoDaLinha[];
}

export interface PodeConfirmar {
  readonly pronta: boolean;
  readonly motivo?: string;
}

interface Props {
  readonly studentId?: string;
  readonly sessionId?: string;
  readonly linhas: readonly LinhaDeRevisao[];
  readonly podeConfirmar?: PodeConfirmar;
  /** Todo `importId` da sessão -- alimenta o descarte em bloco. */
  readonly importIds?: readonly string[];
}

const MOTIVO_LEGIVEL: Record<string, string> = {
  SESSION_EMPTY: 'A sessão não tem nenhum arquivo processado ainda.',
  BIOIMPEDANCE_REQUIRED: 'Falta o arquivo da balança de bioimpedância nesta sessão.',
  DIVERGENCE_UNRESOLVED:
    'Escolha qual valor vale para cada campo divergente antes de confirmar.',
};

const ESTADO_INICIAL_CONFIRMACAO: EstadoDaConfirmacao = {};
const ESTADO_INICIAL_REVISAO: EstadoDaRevisao = {};
const ESTADO_INICIAL_DESCARTE: EstadoDoDescarte = {};

/** Agora, no formato que `<input type="datetime-local">` aceita como valor. */
function agoraParaDatetimeLocal(): string {
  const agora = new Date();
  const semFuso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);

  return semFuso.toISOString().slice(0, 16);
}

/** Quantos campos, do total, ainda precisam de conferência (estado `PENDING`). */
function contarPendentes(linhas: readonly LinhaDeRevisao[]): { pendentes: number; total: number } {
  let pendentes = 0;
  let total = 0;

  for (const linha of linhas) {
    for (const campo of linha.campos) {
      total += 1;
      if (campo.state === 'PENDING') pendentes += 1;
    }
  }

  return { pendentes, total };
}

/** Célula de valor: `Ausente` quando não há número (INV-104), nunca `0`. */
function CelulaDeValor({ campo }: { campo: CampoDaLinha }) {
  return campo.extractedValue === null ? (
    <Ausente />
  ) : (
    <>{valorLegivel(campo.extractedValue, campo.extractedUnit)}</>
  );
}

function CelulaDeConfianca({ confidence }: { confidence: number | null }) {
  const legivel = confiancaLegivel(confidence);

  return legivel === null ? <Ausente /> : <>{legivel}</>;
}

/**
 * Uma opção de um campo divergente -- radio isolado, nunca marcado por
 * padrão. Escolher a opção SUBMETE a decisão na hora (`revisarCampo`): é o
 * ato de "escolher qual valor vale", não um rascunho que espera outro botão.
 *
 * Escolher um vencedor exige descartar os OUTROS campos da mesma linha
 * (`outrosCampos`) -- senao eles ficam `PENDING` para sempre e a sessao
 * nunca libera (`sessaoPodeConfirmar`, `sessao-de-revisao.ts`).
 */
function OpcaoDivergente({
  studentId,
  sessionId,
  campo,
  outrosCampos,
}: {
  studentId: string | undefined;
  sessionId: string | undefined;
  campo: CampoDaLinha;
  outrosCampos: readonly CampoDaLinha[];
}) {
  const idDaOpcao = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [estado, revisar] = useActionState(revisarCampo, ESTADO_INICIAL_REVISAO);

  useToastDeErro(estado.erro, 'error', `erro-revisao-${campo.id}`);

  return (
    <tr className={estilos['linhaDivergente']} data-testid={`linha-divergente-${campo.id}`}>
      <td>{rotuloDeTipo(campo.type)}</td>
      <td>
        <CelulaDeValor campo={campo} />
      </td>
      <td>{faixaLegivel(campo.referenceMin, campo.referenceMax, campo.extractedUnit)}</td>
      <td>
        <span className={estilos['origem']}>{campo.sourceLabel ?? 'origem não identificada'}</span>
      </td>
      <td>
        <CelulaDeConfianca confidence={campo.confidence} />
      </td>
      <td>
        <StateBadge machine="leitura" state={campo.leitura} />
      </td>
      <td>
        <form ref={formRef} action={revisar}>
          <input type="hidden" name="studentId" value={studentId ?? ''} />
          <input type="hidden" name="sessionId" value={sessionId ?? ''} />
          <input type="hidden" name="importId" value={campo.importId ?? ''} />
          <input type="hidden" name="fieldId" value={campo.id} />
          <input type="hidden" name="state" value="CONFIRMED" />
          {outrosCampos
            .filter((outro) => outro.importId !== undefined)
            .map((outro) => (
              <input
                key={outro.id}
                type="hidden"
                name="discardPair"
                value={`${outro.importId}:${outro.id}`}
              />
            ))}
          <label htmlFor={idDaOpcao} className={estilos['opcaoDivergente']}>
            <input
              id={idDaOpcao}
              type="radio"
              name={`campo-${campo.type}`}
              value={campo.id}
              aria-label={`Usar o valor de ${campo.sourceLabel ?? 'origem não identificada'}`}
              onChange={() => formRef.current?.requestSubmit()}
            />
            Usar este valor
          </label>
        </form>
      </td>
    </tr>
  );
}

/** Linha concordante -- os arquivos bateram, uma linha só com o selo das origens. */
function LinhaConcordante({ linha }: { linha: LinhaDeRevisao }) {
  const campo = linha.campos[0];

  if (campo === undefined) return null;

  return (
    <tr data-testid={`linha-concordante-${linha.type}`}>
      <td>{rotuloDeTipo(linha.type)}</td>
      <td>
        <CelulaDeValor campo={campo} />
      </td>
      <td>{faixaLegivel(campo.referenceMin, campo.referenceMax, campo.extractedUnit)}</td>
      <td>
        <span className={estilos['origem']}>{linha.origens.length} arquivos</span>
      </td>
      <td>
        <CelulaDeConfianca confidence={campo.confidence} />
      </td>
      <td>
        <StateBadge machine="leitura" state={campo.leitura} />
      </td>
      <td />
    </tr>
  );
}

function BotaoDeConfirmar({ desabilitado, total }: { desabilitado: boolean; total: number }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={desabilitado || pending} data-testid="confirmar-sessao">
      {pending ? 'Confirmando…' : `Confirmar ${total} ${total === 1 ? 'campo' : 'campos'}`}
    </button>
  );
}

function BotaoDeDescartar() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="descartar-extracao"
      className={estilos['descartar']}
    >
      {pending ? 'Descartando…' : 'Descartar extração'}
    </button>
  );
}

export function RevisaoDeCampos({
  studentId,
  sessionId,
  linhas,
  podeConfirmar,
  importIds = [],
}: Props) {
  const [estado, confirmar] = useActionState(confirmarSessao, ESTADO_INICIAL_CONFIRMACAO);
  const [estadoDoDescarte, descartar] = useActionState(descartarSessao, ESTADO_INICIAL_DESCARTE);

  useToastDeErro(estado.erro, 'error', 'erro-ao-confirmar');
  useToastDeErro(estadoDoDescarte.erro, 'error', 'erro-ao-descartar');

  const pronta = podeConfirmar?.pronta ?? true;
  const motivo = podeConfirmar?.motivo ? MOTIVO_LEGIVEL[podeConfirmar.motivo] : undefined;
  const { pendentes, total } = contarPendentes(linhas);

  return (
    <section aria-labelledby="titulo-revisao">
      <h2 id="titulo-revisao">Revisão campo a campo</h2>
      <p data-testid="contador-pendentes">
        {pendentes} de {total} {total === 1 ? 'campo exige' : 'campos exigem'} conferência
      </p>

      <table className={estilos['tabela']}>
        <thead>
          <tr>
            <th scope="col">Campo</th>
            <th scope="col">Valor extraído</th>
            <th scope="col">Faixa de referência</th>
            <th scope="col">Origem</th>
            <th scope="col">Confiança</th>
            <th scope="col">Leitura</th>
            <th scope="col">Ação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) =>
            linha.concordante ? (
              <LinhaConcordante key={linha.type} linha={linha} />
            ) : (
              linha.campos.map((campo) => (
                <OpcaoDivergente
                  key={campo.id}
                  studentId={studentId}
                  sessionId={sessionId}
                  campo={campo}
                  outrosCampos={linha.campos.filter((outro) => outro.id !== campo.id)}
                />
              ))
            ),
          )}
        </tbody>
      </table>

      {!pronta && motivo !== undefined ? (
        <p className={estilos['motivo']} data-testid="motivo-bloqueio">
          {motivo}
        </p>
      ) : null}

      <p className={estilos['textoDeRodape']}>
        Ao confirmar, os valores viram uma avaliação e ficam visíveis para o aluno no app e no
        totem.
      </p>

      <div className={estilos['botoesDeRodape']}>
        <form action={descartar}>
          <input type="hidden" name="studentId" value={studentId ?? ''} />
          <input type="hidden" name="sessionId" value={sessionId ?? ''} />
          {importIds.map((importId) => (
            <input key={importId} type="hidden" name="importId" value={importId} />
          ))}
          <BotaoDeDescartar />
        </form>

        <form action={confirmar} className={estilos['acoes']}>
          <input type="hidden" name="studentId" value={studentId ?? ''} />
          <input type="hidden" name="sessionId" value={sessionId ?? ''} />
          <Field
            id="assessedAt"
            name="assessedAt"
            label="Data e hora da medição"
            type="datetime-local"
            defaultValue={agoraParaDatetimeLocal()}
            required
            data-testid="campo-assessed-at"
          />
          <BotaoDeConfirmar desabilitado={!pronta} total={total} />
        </form>
      </div>
    </section>
  );
}
