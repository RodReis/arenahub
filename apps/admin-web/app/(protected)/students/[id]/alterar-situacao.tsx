'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { alterarSituacao, type EstadoDaSituacao } from '../../../actions/students';
import {
  MOTIVO_DA_SITUACAO,
  ROTULO_DE_SITUACAO,
  SITUACOES_COM_MOTIVO,
  situacoesPossiveis,
} from '../../../../src/students/formatar';

interface Props {
  studentId: string;
  situacaoAtual: string;
  version: number;
}

const ESTADO_INICIAL: EstadoDaSituacao = {};

function BotaoDeAlteracao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-situacao">
      {pending ? 'Alterando…' : 'Alterar situação'}
    </Button>
  );
}

/**
 * Mudança de situação do aluno.
 *
 * O select oferece SÓ as transições que a API aceita. Sem isso, a recepção
 * escolheria um destino inválido e receberia um 409 traduzido depois do
 * clique — erro evitável vira erro explicado, que é pior.
 *
 * A `version` viaja junto: é o controle otimista que impede duas pessoas de
 * sobrescreverem a alteração uma da outra sem perceber.
 */
export function AlterarSituacao({ studentId, situacaoAtual, version }: Props) {
  const [estado, acao] = useActionState(alterarSituacao, ESTADO_INICIAL);
  // Erro vira TOAST -- CLAUDE.md: "sempre usar Toast para: Info, Warn e
  // error". O toast ja carrega `role="alert"`, entao o anuncio ao leitor de
  // tela nao regride com a saida do `<p role="alert">`.
  useToastDeErro(estado.erro, 'error', 'erro-da-situacao');


  // Depois de uma alteração, a verdade é o que a API devolveu -- não o que
  // veio na carga da página. `revalidatePath` atualiza o Server Component,
  // mas este componente segue montado com as props iniciais: sem estas duas
  // linhas, a SEGUNDA alteração seguida mandaria a versão velha e levaria um
  // "alguém alterou este aluno enquanto você editava" sem ninguém mais
  // envolvido.
  const situacaoVigente = estado.sucesso?.status ?? situacaoAtual;
  const versaoVigente = estado.sucesso?.version ?? version;

  /*
   * O DESTINO ESCOLHIDO precisa ser estado, e nao so valor do `<select>`: e
   * ele que decide se o campo de motivo aparece. Suspender e bloquear exigem
   * razao (DS-PAINEL.md §5.1); cancelar e arquivar nao, e a API RECUSA razao
   * neles -- entao o campo nao pode nem existir ali.
   */
  const [destinoEscolhido, setDestinoEscolhido] = useState('');

  /*
   * O DESTINO SE ZERA JUNTO COM O SELECT, e não sozinho.
   *
   * O `key={situacaoVigente}` lá embaixo remonta o `<select>` quando a
   * situação muda -- ele volta para "Selecione…". Mas este estado é do
   * COMPONENTE, não do select: sem esta linha ele guardava o último destino
   * escolhido, e depois de suspender alguém o campo de motivo continuava na
   * tela com o select já vazio. Visto na tela; nenhum teste montava o
   * componente duas vezes seguidas.
   */
  const [ancora, setAncora] = useState(situacaoVigente);

  if (ancora !== situacaoVigente) {
    setAncora(situacaoVigente);
    setDestinoEscolhido('');
  }

  const destinos = situacoesPossiveis(situacaoVigente);
  const pedeMotivo = SITUACOES_COM_MOTIVO.has(destinoEscolhido);

  if (destinos.length === 0) {
    return (
      <p data-testid="situacao-terminal">
        Este cadastro está arquivado. Não há mudança de situação possível.
      </p>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>

      {estado.sucesso ? (
        <p role="status" data-testid="situacao-alterada">
          Situação alterada para {ROTULO_DE_SITUACAO[estado.sucesso.status] ?? estado.sucesso.status}.
        </p>
      ) : null}

      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="version" value={versaoVigente} />

      {/*
        `key` pela situação vigente: quando ela muda, os destinos possíveis
        mudam junto e o select precisa remontar. Sem a chave, o React
        reaproveita o elemento e mantém selecionada uma opção que acabou de
        sair da lista.
      */}
      <SelectField
        key={situacaoVigente}
        id="situacao"
        name="status"
        label="Nova situação"
        defaultValue=""
        required
        onChange={(evento) => setDestinoEscolhido(evento.target.value)}
        data-testid="campo-situacao"
      >
        <option value="">Selecione…</option>
        {destinos.map((destino) => (
          <option key={destino} value={destino}>
            {ROTULO_DE_SITUACAO[destino] ?? destino}
          </option>
        ))}
      </SelectField>

      {/*
        MONTADO E DESMONTADO, nunca escondido com `hidden`: campo `required`
        dentro de bloco escondido é validado pelo navegador do mesmo jeito, e
        o formulário trava sem dizer por quê -- o usuário clica em "Alterar" e
        nada acontece. Ausente do DOM, o campo não valida nada.
      */}
      {pedeMotivo ? (
        <>
          <SelectField
            id="motivo-da-situacao"
            name="reason"
            label="Motivo"
            defaultValue=""
            required
            data-testid="campo-motivo-da-situacao"
          >
            <option value="">Selecione…</option>
            {Object.entries(MOTIVO_DA_SITUACAO).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </SelectField>

          {/*
            A OBSERVAÇÃO É OPCIONAL e acompanha a razão, não a substitui. A
            razão fechada responde "por quê" e permite contar; a observação
            responde "o que exatamente" no caso concreto.

            O `hint` diz isso onde a pessoa decide se escreve ou não -- e,
            por vir do `Field`, é lido junto do campo por quem usa leitor de
            tela, não como parágrafo à parte.
          */}
          <Field
            id="observacao-da-situacao"
            name="reasonNote"
            label="Observação (opcional)"
            hint="O caso concreto: prazo, número do atestado, o que combinaram."
            maxLength={500}
            data-testid="campo-observacao-da-situacao"
          />
        </>
      ) : null}

      <BotaoDeAlteracao />
    </form>
  );
}
