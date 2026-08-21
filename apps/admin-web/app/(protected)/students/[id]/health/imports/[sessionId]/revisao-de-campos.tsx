'use client';

import { useActionState, useId, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { Ausente, Field, useToastDeErro } from '@arenahub/ui';

import {
  confirmarSessao,
  revisarCampo,
  type EstadoDaConfirmacao,
  type EstadoDaRevisao,
} from '../../../../../../actions/assessment-imports';
import { rotuloDeTipo, valorLegivel } from '../../../../../../../src/health/formatar';
import estilos from './sessao.module.css';

/**
 * Revisao campo a campo de uma sessao multiarquivo -- Task 9.
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
  readonly sourceLabel: string | null;
  readonly state: string;
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
}

const MOTIVO_LEGIVEL: Record<string, string> = {
  SESSION_EMPTY: 'A sessão não tem nenhum arquivo processado ainda.',
  BIOIMPEDANCE_REQUIRED: 'Falta o arquivo da balança de bioimpedância nesta sessão.',
  DIVERGENCE_UNRESOLVED:
    'Escolha qual valor vale para cada campo divergente antes de confirmar.',
};

const ESTADO_INICIAL_CONFIRMACAO: EstadoDaConfirmacao = {};
const ESTADO_INICIAL_REVISAO: EstadoDaRevisao = {};

/** Agora, no formato que `<input type="datetime-local">` aceita como valor. */
function agoraParaDatetimeLocal(): string {
  const agora = new Date();
  const semFuso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);

  return semFuso.toISOString().slice(0, 16);
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
        {campo.extractedValue === null ? (
          <Ausente />
        ) : (
          valorLegivel(campo.extractedValue, campo.extractedUnit)
        )}
      </td>
      <td>
        <span className={estilos['origem']}>{campo.sourceLabel ?? 'origem não identificada'}</span>
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
        {campo.extractedValue === null ? (
          <Ausente />
        ) : (
          valorLegivel(campo.extractedValue, campo.extractedUnit)
        )}
      </td>
      <td>
        <span className={estilos['origem']}>{linha.origens.length} arquivos</span>
      </td>
      <td />
    </tr>
  );
}

function BotaoDeConfirmar({ desabilitado }: { desabilitado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={desabilitado || pending} data-testid="confirmar-sessao">
      {pending ? 'Confirmando…' : 'Confirmar avaliação'}
    </button>
  );
}

export function RevisaoDeCampos({ studentId, sessionId, linhas, podeConfirmar }: Props) {
  const [estado, confirmar] = useActionState(confirmarSessao, ESTADO_INICIAL_CONFIRMACAO);

  useToastDeErro(estado.erro, 'error', 'erro-ao-confirmar');

  const pronta = podeConfirmar?.pronta ?? true;
  const motivo = podeConfirmar?.motivo ? MOTIVO_LEGIVEL[podeConfirmar.motivo] : undefined;

  return (
    <section aria-labelledby="titulo-revisao">
      <h2 id="titulo-revisao">Revisão dos campos</h2>

      <table className={estilos['tabela']}>
        <thead>
          <tr>
            <th scope="col">Medida</th>
            <th scope="col">Valor</th>
            <th scope="col">Origem</th>
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
        <BotaoDeConfirmar desabilitado={!pronta} />
      </form>
    </section>
  );
}
