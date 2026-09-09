'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import {
  enviarArquivoDeMarca,
  type EstadoDoUploadDeMarca,
} from '../../../actions/platform';

const ESTADO_INICIAL: EstadoDoUploadDeMarca = {};

/** Os dois formatos que a API aceita, na forma que o seletor de arquivo lê. */
const FORMATOS = 'image/svg+xml,image/png';

interface PropsDoEnvio {
  readonly tenantId: string;
  readonly slug: string;
  readonly peca: 'logo' | 'icon';
  readonly titulo: string;
  readonly ajuda: string;
  readonly jaEnviado: boolean;
}

function BotaoDeEnvio({ jaEnviado }: { readonly jaEnviado: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="ghost" disabled={pending}>
      {pending ? 'Enviando…' : jaEnviado ? 'Trocar arquivo' : 'Enviar arquivo'}
    </Button>
  );
}

/**
 * Uma peça da identidade visual — logo ou ícone.
 *
 * FORMULÁRIO PRÓPRIO POR PEÇA, e não os dois num só: o envio é imediato (a
 * API grava a coluna na hora), e um formulário compartilhado faria trocar o
 * ícone reenviar o logo junto — dois uploads, dois escaneamentos de antivírus
 * e uma sobrescrita que ninguém pediu.
 */
function EnvioDePeca(props: PropsDoEnvio) {
  const [estado, acao] = useActionState(enviarArquivoDeMarca, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', `erro-do-envio-de-${props.peca}`);

  return (
    <form className={estilos['grupo']} action={acao}>
      <input type="hidden" name="tenantId" value={props.tenantId} />
      <input type="hidden" name="peca" value={props.peca} />

      <p className={estilos['nota']}>
        <strong>{props.titulo}</strong> — {props.ajuda}
      </p>

      {/*
        A PRÉ-VISUALIZAÇÃO é o que prova que o arquivo certo entrou. Sem ela,
        quem envia vê "Enviado." e vai embora achando que subiu o logo novo
        quando subiu o antigo de novo.

        `key` com o estado do envio força o navegador a rebuscar a imagem: a
        URL não muda entre uma troca e outra (o nome do objeto é fixo por
        peça), e sem isso o cache do navegador continuaria pintando o arquivo
        anterior.
      */}
      {props.jaEnviado || estado.enviado ? (
        <img
          key={String(estado.enviado)}
          className={estilos['previa']}
          src={`/marca/${encodeURIComponent(props.slug)}/${props.peca}`}
          alt={`${props.titulo} da academia`}
          data-testid={`previa-de-${props.peca}`}
        />
      ) : null}

      <input
        type="file"
        name="file"
        accept={FORMATOS}
        aria-label={`Arquivo do ${props.titulo.toLowerCase()}`}
        data-testid={`campo-de-${props.peca}`}
      />

      {estado.enviado ? (
        <p role="status" data-testid={`${props.peca}-enviado`}>
          Enviado.
        </p>
      ) : null}

      <div className={estilos['acoes']}>
        <BotaoDeEnvio jaEnviado={props.jaEnviado} />
      </div>
    </form>
  );
}

interface Props {
  readonly tenantId: string;
  readonly slug: string;
  readonly temLogo: boolean;
  readonly temIcone: boolean;
}

/**
 * Logotipo e ícone da academia — F62 (ADR-052 §9).
 *
 * SEPARADO do formulário de cadastro, pelo mesmo critério que já separou a
 * situação e a elevação de suporte nesta tela: envio de arquivo e edição de
 * texto não compartilham botão. Um "Salvar alterações" que às vezes sobe 1 MB
 * pela rede e às vezes não é um botão que a pessoa não consegue prever.
 *
 * SVG É ACEITO AQUI, e é o único lugar do produto onde isso vale (o logotipo
 * de patrocinador do totem recusa). O arquivo é sanitizado na API — script,
 * handler `on*` e `<foreignObject>` são recusados no upload, não removidos.
 */
export function ArquivosDaMarca(props: Props) {
  return (
    <section className={estilos['formulario']} aria-labelledby="titulo-da-marca">
      <h2 id="titulo-da-marca">Logotipo e ícone</h2>

      <p className={estilos['nota']}>
        SVG ou PNG, até 1 MB. SVG com script é recusado — exporte o vetor sem
        script.
      </p>

      <EnvioDePeca
        tenantId={props.tenantId}
        slug={props.slug}
        peca="logo"
        titulo="Logotipo"
        ajuda="aparece na tela de entrada da academia."
        jaEnviado={props.temLogo}
      />

      <EnvioDePeca
        tenantId={props.tenantId}
        slug={props.slug}
        peca="icon"
        titulo="Ícone"
        ajuda="aparece na aba do navegador. Use um vetor quadrado."
        jaEnviado={props.temIcone}
      />
    </section>
  );
}
