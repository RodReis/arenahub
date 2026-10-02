'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToastDeErro } from '@arenahub/ui';

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
 * Atualiza o link do instalador. "Salvar" so acende quando algo mudou: sem
 * isso o botao convida a gravar de novo o que ja esta gravado.
 *
 * "Remover" pede confirmacao no proprio lugar (duas etapas, com o verbo real):
 * apagar o link esconde o botao do totem, e um clique perdido tiraria o
 * instalador do ar para os alunos.
 */
export function FormularioDoInstalador({
  androidUrl,
  androidVersion,
}: {
  readonly androidUrl: string | null;
  readonly androidVersion: string | null;
}) {
  const [estado, acaoSalvar] = useActionState(salvarInstaladorAndroid, ESTADO_INICIAL);
  const [estadoRemocao, acaoRemover] = useActionState(removerInstaladorAndroid, ESTADO_INICIAL);
  const [url, setUrl] = useState(androidUrl ?? '');
  const [versao, setVersao] = useState(androidVersion ?? '');
  const [confirmando, setConfirmando] = useState(false);

  useToastDeErro(estado.erro, 'error', 'erro-do-instalador');
  useToastDeErro(estadoRemocao.erro, 'error', 'erro-ao-remover-instalador');
  useToastDeErro(estado.sucesso ? 'Instalador atualizado.' : undefined, 'info', 'sucesso-do-instalador');
  useToastDeErro(
    estadoRemocao.sucesso ? 'Instalador removido.' : undefined,
    'info',
    'sucesso-ao-remover-instalador',
  );

  const alterado = url.trim() !== (androidUrl ?? '') || versao.trim() !== (androidVersion ?? '');

  return (
    <div className={estilos['formulario']} data-testid="formulario-do-instalador">
      <form className={estilos['formulario']} action={acaoSalvar}>
        <Field
          id="instalador-url"
          name="androidUrl"
          label="URL do APK"
          hint="Precisa começar com https://. O servidor valida antes de salvar."
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
          hint="Mostrada no painel e no totem, ao lado do QR."
          value={versao}
          onChange={(evento) => setVersao(evento.target.value)}
          maxLength={40}
          autoComplete="off"
          data-testid="campo-versao-do-instalador"
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
