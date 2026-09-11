'use client';

import { useActionState, useId, useState, type ChangeEvent } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, SectionCard, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';
import proprios from './cliente.module.css';

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

  /*
   * O NOME DO ARQUIVO ESCOLHIDO, guardado por nós.
   *
   * O controle nativo escrevia "Nenhum arquivo escolhido" ao lado de um botão
   * cinza que o navegador desenha e que nenhum design system alcança -- e o
   * texto dele vem no idioma do navegador, não no do painel. Escondendo o
   * controle para vestir o rótulo, o nome do arquivo passa a ser nosso.
   */
  const [arquivo, setArquivo] = useState<string | null>(null);
  const idDoCampo = useId();

  useToastDeErro(estado.erro, 'error', `erro-do-envio-de-${props.peca}`);

  function aoEscolher(evento: ChangeEvent<HTMLInputElement>) {
    setArquivo(evento.target.files?.[0]?.name ?? null);
  }

  return (
    <form className={proprios['peca']} action={acao}>
      <input type="hidden" name="tenantId" value={props.tenantId} />
      <input type="hidden" name="peca" value={props.peca} />

      <p className={proprios['peca-titulo']}>
        <strong>{props.titulo}</strong>
        <span className={estilos['nota']}>{props.ajuda}</span>
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
          alt={`${props.titulo} do cliente`}
          data-testid={`previa-de-${props.peca}`}
        />
      ) : (
        /*
          MOLDURA VAZIA no lugar de nada: sem ela a peca enviada e a nao
          enviada tem alturas diferentes, e as duas colunas dancam quando a
          primeira sobe. A frase dentro dela e o canal que decide -- a moldura
          sozinha poderia ser confundida com uma imagem que nao carregou.
        */
        <p className={proprios['sem-previa']} data-testid={`sem-${props.peca}`}>
          Nenhum arquivo enviado
        </p>
      )}

      {/*
        O CONTROLE NATIVO CONTINUA NO DOM -- é ele que o navegador abre e é
        nele que o Playwright deposita o arquivo (`setInputFiles`). O que muda
        é quem o usuário vê: `.esconder-campo` o tira da tela sem tirá-lo do
        teclado (`sr-only`, não `display:none` -- este último o removeria da
        ordem de tabulação e deixaria o envio só para quem usa mouse).

        O `<label>` é o alvo visível, e é `<label>` e não `<button>` de
        propósito: rótulo ligado ao campo por `htmlFor` já abre o seletor no
        clique e no Enter, sem uma linha de JavaScript e sem `ref`.
      */}
      <input
        type="file"
        name="file"
        id={idDoCampo}
        accept={FORMATOS}
        className={proprios['esconder-campo']}
        aria-label={`Arquivo do ${props.titulo.toLowerCase()}`}
        data-testid={`campo-de-${props.peca}`}
        onChange={aoEscolher}
      />

      <div className={proprios['escolha']}>
        <label className={proprios['botao-de-escolha']} htmlFor={idDoCampo}>
          {props.jaEnviado ? 'Escolher outro' : 'Escolher arquivo'}
        </label>

        {/*
          O NOME DO ARQUIVO é a confirmação de que o certo entrou -- e o vazio
          diz o que fazer, não o que falta: "Nenhum arquivo escolhido" do
          navegador descreve o estado; "SVG ou PNG, até 1 MB" descreve o aceito.
        */}
        <span className={proprios['nome-do-arquivo']} data-testid={`nome-de-${props.peca}`}>
          {arquivo ?? 'SVG ou PNG, até 1 MB'}
        </span>
      </div>

      {estado.enviado ? (
        <p className={proprios['peca-enviada']} role="status" data-testid={`${props.peca}-enviado`}>
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
 * Logotipo e ícone do cliente — F62 (ADR-052 §9).
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
    <SectionCard
      title="Logotipo e ícone"
      icon="image"
      summary="SVG ou PNG, até 1 MB. SVG com script é recusado — exporte o vetor sem script."
      testId="arquivos-da-marca"
    >
      <div className={proprios['pecas']}>
        <EnvioDePeca
        tenantId={props.tenantId}
        slug={props.slug}
        peca="logo"
        titulo="Logotipo"
          ajuda="Aparece na tela de entrada do cliente."
          jaEnviado={props.temLogo}
        />

        <EnvioDePeca
        tenantId={props.tenantId}
        slug={props.slug}
        peca="icon"
        titulo="Ícone"
          ajuda="Aparece na aba do navegador. Use um vetor quadrado."
          jaEnviado={props.temIcone}
        />
      </div>
    </SectionCard>
  );
}
