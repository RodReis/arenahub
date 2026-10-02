'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToastDeErro } from '@arenahub/ui';

import { useToastDeSucesso } from './toast-de-sucesso';

import {
  removerInstaladorAndroid,
  salvarInstaladorAndroid,
  type EstadoDoInstalador,
} from '../../actions/instalador-android';
import estilos from './aplicativo.module.css';

const ESTADO_INICIAL: EstadoDoInstalador = {};

function BotaoSalvar({ alterado }: { readonly alterado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || !alterado} data-testid="salvar-instalador">
      {pending ? 'Salvando…' : 'Salvar'}
    </Button>
  );
}

/**
 * APK, versao e final do link. "Salvar" so acende quando algo mudou -- e o
 * final SUGERIDO conta como mudanca enquanto nao foi reservado: sem isso o
 * campo vinha preenchido, o botao apagado, e o link curto nunca existia.
 *
 * A mensagem para o aluno se edita no proprio cartao dela, ao lado da previa.
 *
 * "Remover" pede confirmacao no proprio lugar (duas etapas, com o verbo real):
 * apagar o link esconde o botao do totem, e um clique perdido tiraria o
 * instalador do ar para os alunos.
 */
export function FormularioDoInstalador({
  androidUrl,
  androidVersion,
  finalSugerido,
  finalReservado,
  prefixoDoLink,
}: {
  readonly androidUrl: string | null;
  readonly androidVersion: string | null;
  /** O final reservado ou, sem ele, a sugestao (identificador da academia). */
  readonly finalSugerido: string;
  /** O que esta gravado de fato. Nulo = o link curto ainda nao existe. */
  readonly finalReservado: string | null;
  /** `arenahub.up.railway.app/baixar/` -- so para mostrar como o link fica. */
  readonly prefixoDoLink: string;
}) {
  const [estado, acaoSalvar] = useActionState(salvarInstaladorAndroid, ESTADO_INICIAL);
  const [estadoRemocao, acaoRemover] = useActionState(removerInstaladorAndroid, ESTADO_INICIAL);
  const [url, setUrl] = useState(androidUrl ?? '');
  const [versao, setVersao] = useState(androidVersion ?? '');
  const [final, setFinal] = useState(finalSugerido);
  const [confirmando, setConfirmando] = useState(false);

  useToastDeErro(estado.erro, 'error', 'erro-do-instalador');
  useToastDeErro(estadoRemocao.erro, 'error', 'erro-ao-remover-instalador');
  useToastDeSucesso(estado, 'salvo', 'Instalador atualizado.', 'sucesso-do-instalador');
  useToastDeSucesso(estadoRemocao, 'removido', 'Instalador removido.', 'sucesso-ao-remover-instalador');

  const alterado =
    url.trim() !== (androidUrl ?? '') ||
    versao.trim() !== (androidVersion ?? '') ||
    final.trim() !== (finalReservado ?? '');
  const linkPendente = finalReservado === null && final.trim() !== '';

  return (
    <div className={estilos['formulario']} data-testid="formulario-do-instalador">
      <form className={estilos['formulario']} action={acaoSalvar}>
        <Field
          id="instalador-url"
          name="androidUrl"
          label="URL do APK"
          hint="Cole o link do APK gerado pelo EAS. Precisa começar com https://."
          placeholder="https://expo.dev/artifacts/eas/…apk"
          value={url}
          onChange={(evento) => setUrl(evento.target.value)}
          maxLength={2048}
          inputMode="url"
          autoComplete="off"
          data-testid="campo-url-do-instalador"
        />

        <Field
          id="instalador-versao"
          name="androidVersion"
          label="Versão"
          hint="Aparece no painel e no totem, ao lado do QR."
          placeholder="ex.: 0.1.0 (build 8)"
          value={versao}
          onChange={(evento) => setVersao(evento.target.value)}
          maxLength={40}
          autoComplete="off"
          data-testid="campo-versao-do-instalador"
        />

        <Field
          id="instalador-final-do-link"
          name="shortSlug"
          label="Final do link"
          hint={
            linkPendente
              ? `Salve para ativar ${prefixoDoLink}${final.trim()} — o link curto ainda não existe.`
              : `O aluno recebe ${prefixoDoLink}${final.trim() || '…'} — não muda quando o APK for trocado.`
          }
          placeholder="ex.: arena"
          value={final}
          onChange={(evento) => setFinal(evento.target.value.toLowerCase())}
          minLength={3}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          data-testid="campo-final-do-link"
        />

        <div className={estilos['acoes']}>
          {androidUrl && confirmando ? (
            <>
              <span className={estilos['confirmacao']}>Tirar o instalador do ar?</span>
              <Button type="button" variant="outline" onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
              {/* Envia o OUTRO formulario (abaixo, invisivel): dois formularios
                  nao se aninham, e o `form=` liga o botao a ele. */}
              <Button
                type="submit"
                form="form-remover-instalador"
                variant="destructive"
                data-testid="confirmar-remocao-do-instalador"
              >
                Remover o instalador
              </Button>
            </>
          ) : (
            <>
              {androidUrl ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmando(true)}
                  data-testid="remover-instalador"
                >
                  Remover
                </Button>
              ) : null}
              <BotaoSalvar alterado={alterado} />
            </>
          )}
        </div>
      </form>

      <form id="form-remover-instalador" action={acaoRemover} hidden />
    </div>
  );
}
