'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Icon, TextareaField, useToastDeErro } from '@arenahub/ui';

import { salvarInstaladorAndroid, type EstadoDoInstalador } from '../../actions/instalador-android';
import estilos from './aplicativo.module.css';
import { MENSAGEM_PADRAO, linkDoWhatsApp, montarMensagem } from './mensagem';

const ESTADO_INICIAL: EstadoDoInstalador = {};

function BotaoSalvarMensagem({ alterada }: { readonly alterada: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || !alterada} data-testid="salvar-mensagem">
      {pending ? 'Salvando…' : 'Salvar mensagem'}
    </Button>
  );
}

/**
 * A mensagem pronta (#538): previa em balao -- exatamente o texto que o aluno
 * recebe -- e, para quem pode, o editor AO LADO, com a previa acompanhando a
 * digitacao. Copiar e abrir no WhatsApp; o contato a recepcao escolhe la, e o
 * painel nunca guarda telefone de aluno para isto.
 *
 * Salvar a mensagem reenvia o APK e a versao ATUAIS (campos ocultos): a mesma
 * rota grava tudo, e sem eles a mensagem nao teria como ser salva sozinha.
 */
export function MensagemParaAluno({
  modelo,
  link,
  academia,
  podeEditar,
  androidUrl,
  androidVersion,
}: {
  readonly modelo: string | null;
  readonly link: string;
  readonly academia: string;
  readonly podeEditar: boolean;
  readonly androidUrl: string;
  readonly androidVersion: string | null;
}) {
  const textoGravado = modelo ?? MENSAGEM_PADRAO;
  const [texto, setTexto] = useState(textoGravado);
  const [copiada, setCopiada] = useState(false);
  const [estado, acao] = useActionState(salvarInstaladorAndroid, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-mensagem');
  useToastDeErro(estado.sucesso ? 'Mensagem salva.' : undefined, 'info', 'sucesso-da-mensagem');

  const mensagem = montarMensagem(texto, { link, academia });

  const copiar = (): void => {
    void navigator.clipboard
      .writeText(mensagem)
      .then(() => {
        setCopiada(true);
        setTimeout(() => setCopiada(false), 2000);
      })
      .catch(() => setCopiada(false));
  };

  const previa = (
    <div className={estilos['colunaDaPrevia']}>
      <div className={estilos['balao']} data-testid="previa-da-mensagem">
        {mensagem}
      </div>

      <div className={estilos['acoesDaMensagem']}>
        <Button
          type="button"
          variant="outline"
          onClick={copiar}
          data-testid="copiar-mensagem"
          data-copiado={copiada ? 'true' : 'false'}
          aria-live="polite"
        >
          <Icon name={copiada ? 'check-circle' : 'copy'} />
          {copiada ? 'Mensagem copiada' : 'Copiar mensagem'}
        </Button>
        <Button
          type="button"
          onClick={() => {
            // Aba nova e sem `opener`: o WhatsApp Web nao ganha acesso ao painel.
            window.open(linkDoWhatsApp(mensagem), '_blank', 'noopener,noreferrer');
          }}
          data-testid="abrir-no-whatsapp"
        >
          <Icon name="message-circle" />
          Abrir no WhatsApp
        </Button>
      </div>
    </div>
  );

  if (!podeEditar) return <div className={estilos['mensagem']}>{previa}</div>;

  return (
    <div className={estilos['mensagemComEditor']}>
      {previa}

      <form className={estilos['editorDaMensagem']} action={acao}>
        <input type="hidden" name="androidUrl" value={androidUrl} />
        <input type="hidden" name="androidVersion" value={androidVersion ?? ''} />
        <TextareaField
          id="instalador-mensagem"
          name="messageTemplate"
          label="Texto da mensagem"
          hint="{link} vira o link curto e {academia}, o nome da academia. A prévia ao lado acompanha."
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          rows={10}
          maxLength={1000}
          data-testid="campo-mensagem-do-instalador"
        />
        <div className={estilos['acoesDoEditor']}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setTexto(MENSAGEM_PADRAO)}
            disabled={texto === MENSAGEM_PADRAO}
            data-testid="restaurar-mensagem"
          >
            Restaurar padrão
          </Button>
          <BotaoSalvarMensagem alterada={texto !== textoGravado} />
        </div>
      </form>
    </div>
  );
}
