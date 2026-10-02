'use client';

import { useActionState, useState, type CSSProperties, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { BRAND, Button, Icon, IconeWhatsApp, TextareaField, useToastDeErro } from '@arenahub/ui';

import { salvarInstaladorAndroid, type EstadoDoInstalador } from '../../actions/instalador-android';
import { Abas, type Aba } from '../../../src/components/abas';
import estilos from './aplicativo.module.css';
import { Conversa } from './conversa';
import { useToastDeSucesso } from './toast-de-sucesso';
import { MENSAGEM_PADRAO, linkDoWhatsApp, montarMensagem } from './mensagem';

const ESTADO_INICIAL: EstadoDoInstalador = {};

/** O verde do WhatsApp vem do token de marca em JS; o CSS so le a variavel. */
const COR_DO_WHATSAPP = { '--cor-whatsapp': BRAND.whatsapp } as CSSProperties;

function BotaoSalvarMensagem({ alterada }: { readonly alterada: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || !alterada} data-testid="salvar-mensagem">
      {pending ? 'Salvando…' : 'Salvar mensagem'}
    </Button>
  );
}

/**
 * O lado de ENVIAR da pagina (#538), em abas: "Mensagem" (o que o aluno vai
 * receber, pronto para copiar ou abrir no WhatsApp) e, para Dono/Gerente,
 * "Editar texto" e "Instalador". Abas e nao cartoes empilhados: a pagina cabe
 * na tela sem rolagem, e a recepcao -- que so envia -- ve uma aba so.
 *
 * O texto vive AQUI, acima das abas: editar numa aba muda a conversa da
 * outra na hora. O `Abas` mantem todos os paineis montados, entao nada se
 * perde ao trocar de aba.
 *
 * Salvar a mensagem reenvia o APK e a versao ATUAIS (campos ocultos): a mesma
 * rota grava tudo; sem eles a mensagem nao teria como ser salva sozinha.
 */
export function PainelDeEnvio({
  modelo,
  link,
  academia,
  podeEditar,
  androidUrl,
  androidVersion,
  configuracao,
}: {
  readonly modelo: string | null;
  readonly link: string;
  readonly academia: string;
  readonly podeEditar: boolean;
  readonly androidUrl: string;
  readonly androidVersion: string | null;
  /** O formulario do instalador -- so para quem pode editar. */
  readonly configuracao?: ReactNode;
}) {
  const textoGravado = modelo ?? MENSAGEM_PADRAO;
  const [texto, setTexto] = useState(textoGravado);
  const [copiada, setCopiada] = useState(false);
  const [estado, acao] = useActionState(salvarInstaladorAndroid, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-mensagem');
  useToastDeSucesso(estado, 'salvo', 'Mensagem salva.', 'sucesso-da-mensagem');

  const mensagem = montarMensagem(texto, { link, academia });
  // Texto vazio grava o padrao: comparar como o servidor vai gravar, senao o
  // Salvar fica aceso para sempre depois de gravar o campo em branco.
  const alterada = (texto.trim() ? texto : MENSAGEM_PADRAO) !== textoGravado;

  const copiar = (): void => {
    // Sem HTTPS (painel aberto pelo IP da rede) `navigator.clipboard` nao
    // existe: o erro vira rejeicao tratada em vez de excecao no clique.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(mensagem))
      .then(() => {
        setCopiada(true);
        setTimeout(() => setCopiada(false), 1800);
      })
      .catch(() => setCopiada(false));
  };

  const abaMensagem: Aba = {
    id: 'mensagem',
    rotulo: 'Mensagem ao aluno',
    conteudo: (
      <div className={estilos['abaMensagem']} style={COR_DO_WHATSAPP}>
        <Conversa mensagem={mensagem} link={link} academia={academia} destaque={copiada} />

        <div className={estilos['acoesDaMensagem']}>
          <button
            type="button"
            className={estilos['botaoWhatsApp']}
            onClick={() => {
              // Aba nova e sem `opener`: o WhatsApp Web nao ganha acesso ao painel.
              window.open(linkDoWhatsApp(mensagem), '_blank', 'noopener,noreferrer');
            }}
            data-testid="abrir-no-whatsapp"
          >
            <IconeWhatsApp />
            Abrir no WhatsApp
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={copiar}
            data-testid="copiar-mensagem"
            data-copiado={copiada ? 'true' : 'false'}
            aria-live="polite"
          >
            <Icon name={copiada ? 'check-circle' : 'copy'} />
            {copiada ? 'Copiada!' : 'Copiar mensagem'}
          </Button>
        </div>
      </div>
    ),
  };

  const abaTexto: Aba = {
    id: 'texto',
    rotulo: 'Editar texto',
    conteudo: (
      <form className={estilos['editorDaMensagem']} action={acao}>
        <input type="hidden" name="androidUrl" value={androidUrl} />
        <input type="hidden" name="androidVersion" value={androidVersion ?? ''} />
        <TextareaField
          id="instalador-mensagem"
          name="messageTemplate"
          label="Texto da mensagem"
          hint="{link} vira o link curto e {academia}, o nome da academia. A aba “Mensagem ao aluno” mostra o resultado."
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          rows={9}
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
          <BotaoSalvarMensagem alterada={alterada} />
        </div>
      </form>
    ),
  };

  const abas: Aba[] = [abaMensagem];
  if (podeEditar) abas.push(abaTexto);
  if (configuracao) abas.push({ id: 'instalador', rotulo: 'Instalador', conteudo: configuracao });

  return abas.length > 1 ? (
    <div className={estilos['painelDeAbas']}>
      <Abas rotulo="Enviar e configurar o app" abas={abas} />
    </div>
  ) : (
    abaMensagem.conteudo
  );
}
