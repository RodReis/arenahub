'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  liberarAcessoManual,
  type EstadoDoOverride,
} from '../../../actions/access-override';

interface Unidade {
  id: string;
  name: string;
}

interface Catraca {
  id: string;
  model: string;
  serial: string;
  gymUnitId: string;
}

interface Props {
  unidades: Unidade[];
  catracas: Catraca[];
}

const ESTADO_INICIAL: EstadoDoOverride = {};

/**
 * Botão que sabe quando está enviando.
 *
 * `useFormStatus` desabilita durante o envio. Isso é defesa em profundidade,
 * não a garantia: a de verdade é a chave de idempotência no servidor. Mas
 * evitar o segundo clique é melhor do que precisar deduplicá-lo.
 */
function BotaoDeConfirmacao() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} data-testid="confirmar-liberacao">
      {pending ? 'Liberando…' : 'Confirmar e liberar a catraca'}
    </button>
  );
}

/**
 * Liberação manual — `M1-FR-023`, `M1-AC-008`.
 *
 * CONFIRMAÇÃO EM DOIS PASSOS. O primeiro passo coleta; o segundo mostra o que
 * vai acontecer e pede confirmação. Não é fricção decorativa: este é o único
 * caminho pelo qual alguém entra sem direito, e ele fica numa tela que a
 * recepção usa com pressa, com uma pessoa esperando na frente da catraca.
 *
 * O que a tela NÃO faz: prometer que a catraca abriu. Ela informa que a
 * liberação foi registrada e comandada. Quem confirma o giro é o equipamento,
 * e dizer "pronto, pode passar" antes disso mandaria o operador embora sem
 * saber que falhou.
 */
export function FormularioDeOverride({ unidades, catracas }: Props) {
  const [estado, acao] = useActionState(liberarAcessoManual, ESTADO_INICIAL);

  const [confirmando, setConfirmando] = useState(false);
  const [unidadeId, setUnidadeId] = useState(unidades[0]?.id ?? '');
  const [catracaId, setCatracaId] = useState('');
  const [tipoDeSujeito, setTipoDeSujeito] = useState<'aluno' | 'visitante'>('aluno');
  const [studentId, setStudentId] = useState('');
  const [visitante, setVisitante] = useState('');
  const [motivo, setMotivo] = useState('');

  const catracasDaUnidade = catracas.filter((c) => c.gymUnitId === unidadeId);
  const catracaEscolhida = catracas.find((c) => c.id === catracaId);
  const unidadeEscolhida = unidades.find((u) => u.id === unidadeId);

  const podeConfirmar =
    unidadeId !== '' &&
    catracaId !== '' &&
    motivo.trim().length >= 10 &&
    (tipoDeSujeito === 'aluno' ? studentId.trim() !== '' : visitante.trim().length >= 3);

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="override-registrado">
        <h2>Liberação registrada</h2>

        <p>
          O comando foi enviado à catraca{' '}
          <strong>{catracaEscolhida?.model ?? 'selecionada'}</strong>.
          {estado.sucesso.repetido
            ? ' Esta liberação já havia sido registrada — nenhuma segunda abertura foi comandada.'
            : ''}
        </p>

        {/*
          O id do evento é o que liga esta ação ao registro de auditoria.
          Mostrá-lo permite que a recepção cite o número ao relatar um
          problema, em vez de descrever "a liberação de terça de manhã".
        */}
        <p>
          Registro de acesso: <code data-testid="access-event-id">{estado.sucesso.accessEventId}</code>
        </p>

        <p>
          A passagem só se confirma quando o equipamento reporta o giro. Se a pessoa não
          passar, a catraca volta a travar sozinha.
        </p>

        <a href="/access/override">Registrar outra liberação</a>
      </div>
    );
  }

  return (
    <form action={acao}>
      {estado.erro ? (
        <p role="alert" data-testid="erro-do-override">
          {estado.erro}
        </p>
      ) : null}

      {/* Passo 2: revisão. Os campos viram somente-leitura e viajam como hidden. */}
      {confirmando ? (
        <section aria-labelledby="titulo-confirmacao" data-testid="painel-de-confirmacao">
          <h2 id="titulo-confirmacao">Confirme antes de liberar</h2>

          <dl>
            <dt>Unidade</dt>
            <dd>{unidadeEscolhida?.name ?? '—'}</dd>

            <dt>Catraca</dt>
            <dd>
              {catracaEscolhida ? `${catracaEscolhida.model} (${catracaEscolhida.serial})` : '—'}
            </dd>

            <dt>Quem vai passar</dt>
            <dd data-testid="resumo-sujeito">
              {tipoDeSujeito === 'aluno' ? `Aluno ${studentId}` : `Visitante: ${visitante}`}
            </dd>

            <dt>Motivo registrado</dt>
            <dd data-testid="resumo-motivo">{motivo}</dd>
          </dl>

          <p role="note">
            Esta liberação <strong>não altera</strong> o plano, a assinatura nem o direito de
            acesso da pessoa. Ela abre a catraca uma vez e fica registrada com o seu nome.
          </p>

          <input type="hidden" name="gymUnitId" value={unidadeId} />
          <input type="hidden" name="deviceId" value={catracaId} />
          <input
            type="hidden"
            name="studentId"
            value={tipoDeSujeito === 'aluno' ? studentId : ''}
          />
          <input
            type="hidden"
            name="visitorDescription"
            value={tipoDeSujeito === 'visitante' ? visitante : ''}
          />
          <input type="hidden" name="reason" value={motivo} />

          <BotaoDeConfirmacao />

          <button
            type="button"
            onClick={() => setConfirmando(false)}
            data-testid="voltar-para-edicao"
          >
            Voltar e corrigir
          </button>
        </section>
      ) : (
        <section aria-labelledby="titulo-dados">
          <h2 id="titulo-dados">Dados da liberação</h2>

          <p>
            <label htmlFor="unidade">Unidade</label>
            <select
              id="unidade"
              value={unidadeId}
              onChange={(evento) => {
                setUnidadeId(evento.target.value);
                // Catraca de outra unidade seria recusada pela API; limpar
                // aqui evita o erro em vez de explicá-lo depois.
                setCatracaId('');
              }}
            >
              {unidades.map((unidade) => (
                <option key={unidade.id} value={unidade.id}>
                  {unidade.name}
                </option>
              ))}
            </select>
          </p>

          <p>
            <label htmlFor="catraca">Catraca</label>
            <select
              id="catraca"
              value={catracaId}
              onChange={(evento) => setCatracaId(evento.target.value)}
              data-testid="selecao-de-catraca"
            >
              <option value="">Selecione…</option>
              {catracasDaUnidade.map((catraca) => (
                <option key={catraca.id} value={catraca.id}>
                  {catraca.model} — {catraca.serial}
                </option>
              ))}
            </select>
          </p>

          <fieldset>
            <legend>Quem vai passar</legend>

            <p>
              <label>
                <input
                  type="radio"
                  name="tipoDeSujeito"
                  checked={tipoDeSujeito === 'aluno'}
                  onChange={() => setTipoDeSujeito('aluno')}
                />
                Aluno cadastrado
              </label>

              <label>
                <input
                  type="radio"
                  name="tipoDeSujeito"
                  checked={tipoDeSujeito === 'visitante'}
                  onChange={() => setTipoDeSujeito('visitante')}
                />
                Visitante
              </label>
            </p>

            {tipoDeSujeito === 'aluno' ? (
              <p>
                <label htmlFor="aluno">Identificador do aluno</label>
                <input
                  id="aluno"
                  value={studentId}
                  onChange={(evento) => setStudentId(evento.target.value)}
                  data-testid="campo-aluno"
                />
              </p>
            ) : (
              <p>
                <label htmlFor="visitante">Quem é o visitante</label>
                <input
                  id="visitante"
                  value={visitante}
                  onChange={(evento) => setVisitante(evento.target.value)}
                  maxLength={120}
                  data-testid="campo-visitante"
                />
                {/*
                  LGPD: o mínimo que identifica para a auditoria. Documento
                  de quem nem é cliente ampliaria o tratamento sem base legal
                  que o justifique.
                */}
                <small>Nome e contexto bastam. Não registre documento.</small>
              </p>
            )}
          </fieldset>

          <p>
            <label htmlFor="motivo">Motivo</label>
            <textarea
              id="motivo"
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              rows={3}
              maxLength={300}
              data-testid="campo-motivo"
            />
            <small>
              Mínimo de 10 caracteres. Este texto é o que vai explicar a liberação numa
              auditoria daqui a seis meses.
            </small>
          </p>

          <button
            type="button"
            disabled={!podeConfirmar}
            onClick={() => setConfirmando(true)}
            data-testid="revisar-liberacao"
          >
            Revisar
          </button>
        </section>
      )}
    </form>
  );
}
