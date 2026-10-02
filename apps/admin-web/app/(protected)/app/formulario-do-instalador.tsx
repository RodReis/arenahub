'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, TextareaField, useToastDeErro } from '@arenahub/ui';

import {
  removerInstaladorAndroid,
  salvarInstaladorAndroid,
  type EstadoDoInstalador,
} from '../../actions/instalador-android';
import estilos from './aplicativo.module.css';
import { MENSAGEM_PADRAO } from './mensagem';

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
  shortSlug,
  messageTemplate,
  prefixoDoLink,
}: {
  readonly androidUrl: string | null;
  readonly androidVersion: string | null;
  /** O final reservado, ou a sugestao (identificador da academia). */
  readonly shortSlug: string;
  readonly messageTemplate: string | null;
  /** `arenahub.up.railway.app/baixar/` -- so para mostrar como o link fica. */
  readonly prefixoDoLink: string;
}) {
  const [estado, acaoSalvar] = useActionState(salvarInstaladorAndroid, ESTADO_INICIAL);
  const [estadoRemocao, acaoRemover] = useActionState(removerInstaladorAndroid, ESTADO_INICIAL);
  const [url, setUrl] = useState(androidUrl ?? '');
  const [versao, setVersao] = useState(androidVersion ?? '');
  const [final, setFinal] = useState(shortSlug);
  // O padrao aparece JA escrito: editar parte de um texto e mais facil que
  // escrever do zero, e o marcador {link} fica a vista.
  const textoInicial = messageTemplate ?? MENSAGEM_PADRAO;
  const [texto, setTexto] = useState(textoInicial);
  const [confirmando, setConfirmando] = useState(false);

  useToastDeErro(estado.erro, 'error', 'erro-do-instalador');
  useToastDeErro(estadoRemocao.erro, 'error', 'erro-ao-remover-instalador');
  useToastDeErro(estado.sucesso ? 'Instalador atualizado.' : undefined, 'info', 'sucesso-do-instalador');
  useToastDeErro(
    estadoRemocao.sucesso ? 'Instalador removido.' : undefined,
    'info',
    'sucesso-ao-remover-instalador',
  );

  const alterado =
    url.trim() !== (androidUrl ?? '') ||
    versao.trim() !== (androidVersion ?? '') ||
    final.trim() !== shortSlug ||
    texto !== textoInicial;

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
          hint={`O aluno recebe ${prefixoDoLink}${final.trim() || '…'} — não muda quando o APK for trocado.`}
          placeholder="ex.: arena"
          value={final}
          onChange={(evento) => setFinal(evento.target.value.toLowerCase())}
          minLength={3}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          data-testid="campo-final-do-link"
        />

        <TextareaField
          id="instalador-mensagem"
          name="messageTemplate"
          label="Mensagem para o aluno"
          hint="{link} vira o link curto e {academia}, o nome da academia. Apagar tudo volta ao texto padrão."
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          rows={8}
          maxLength={1000}
          data-testid="campo-mensagem-do-instalador"
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
