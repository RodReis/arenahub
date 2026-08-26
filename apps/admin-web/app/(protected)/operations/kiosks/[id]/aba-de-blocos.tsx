'use client';

import { useRef, useState } from 'react';
import {
  MAXIMO_DE_PATROCINADORES,
  TEMPOS_POR_BLOCO,
  rotuloDePatrocinio,
  type BlocoDaTelaPublica,
  type KioskConfig,
} from '@arenahub/api-contracts';
import { Button, Field, SelectField, TextareaField } from '@arenahub/ui';

import { enviarMidiaAction } from '../../../../actions/kiosk-midia';
import { ROTULO_DO_TIPO, blocoNovo, mover, remover, substituir, tiposDisponiveis } from './blocos';
import estilos from './formulario-de-configuracao.module.css';

interface Props {
  readonly rascunho: KioskConfig;
  readonly kioskDeviceId: string;
  readonly aoMudarBlocos: (blocos: KioskConfig['blocos']) => void;
  readonly aoMudarPatrocinio: (patrocinio: KioskConfig['patrocinio']) => void;
  readonly aoFalhar: (mensagem: string) => void;
}

/**
 * Aba *Blocos publicos* -- F51, `M3.5-FR-004` e `M3.5-FR-006`.
 *
 * COMPONENTE PROPRIO, e nao mais um item no array de abas do formulario:
 * blocos tem lista ordenavel, cinco editores por tipo e upload de midia --
 * inline, empurrariam `formulario-de-configuracao.tsx` bem alem do teto de
 * 800 linhas que o `CLAUDE.md` define.
 *
 * O ESTADO CONTINUA NO PAI: este componente nao guarda rascunho proprio,
 * so avisa. Dois donos do mesmo rascunho e como "salvar" grava a versao de
 * um deles e descarta a do outro.
 */
export function AbaDeBlocos({
  rascunho,
  kioskDeviceId,
  aoMudarBlocos,
  aoMudarPatrocinio,
  aoFalhar,
}: Props) {
  const { blocos, patrocinio } = rascunho;

  const trocarItens = (itens: readonly BlocoDaTelaPublica[]) => {
    aoMudarBlocos({ ...blocos, itens: [...itens] });
  };

  const disponiveis = tiposDisponiveis(blocos.itens);

  return (
    <div className={estilos['secao']}>
      <SelectField
        id="tempoPorBlocoSegundos"
        label="Tempo de cada bloco no rodízio"
        value={String(blocos.tempoPorBlocoSegundos)}
        onChange={(e) => {
          aoMudarBlocos({
            ...blocos,
            tempoPorBlocoSegundos: Number(
              e.target.value,
            ) as KioskConfig['blocos']['tempoPorBlocoSegundos'],
          });
        }}
        data-testid="campo-tempoPorBloco"
      >
        {TEMPOS_POR_BLOCO.map((segundos) => (
          <option key={segundos} value={segundos}>
            {segundos} s
          </option>
        ))}
      </SelectField>

      <p className={estilos['dica']}>
        Os blocos ligados aparecem um por vez, nesta ordem. Cabeçalho, chamada para entrar e a faixa
        de patrocinadores ficam sempre visíveis, fora do rodízio.
      </p>

      <ol className={estilos['listaDeBlocos']} data-testid="lista-de-blocos">
        {blocos.itens.map((bloco, indice) => (
          <li key={bloco.id} className={estilos['bloco']} data-testid={`bloco-${bloco.tipo}`}>
            <div className={estilos['cabecalhoDoBloco']}>
              <label className={estilos['ligaBloco']}>
                <input
                  type="checkbox"
                  checked={bloco.habilitado}
                  onChange={(e) => {
                    trocarItens(substituir(blocos.itens, { ...bloco, habilitado: e.target.checked }));
                  }}
                  data-testid={`ligar-${bloco.tipo}`}
                />
                <strong>{ROTULO_DO_TIPO[bloco.tipo]}</strong>
              </label>

              <div className={estilos['ordem']}>
                {/*
                  Botao DESABILITADO nas pontas, e `mover` ainda assim trata
                  o indice fora da lista: teclado e leitor de tela alcancam o
                  que o CSS esconde, e uma lista embaralhada so apareceria na
                  publicacao.
                */}
                <Button
                  variant="ghost"
                  disabled={indice === 0}
                  onClick={() => {
                    trocarItens(mover(blocos.itens, indice, 'cima'));
                  }}
                  aria-label={`Subir ${ROTULO_DO_TIPO[bloco.tipo]}`}
                  data-testid={`subir-${bloco.tipo}`}
                >
                  ↑
                </Button>

                <Button
                  variant="ghost"
                  disabled={indice === blocos.itens.length - 1}
                  onClick={() => {
                    trocarItens(mover(blocos.itens, indice, 'baixo'));
                  }}
                  aria-label={`Descer ${ROTULO_DO_TIPO[bloco.tipo]}`}
                  data-testid={`descer-${bloco.tipo}`}
                >
                  ↓
                </Button>

                <Button
                  variant="destructive"
                  onClick={() => {
                    trocarItens(remover(blocos.itens, bloco.id));
                  }}
                  aria-label={`Remover ${ROTULO_DO_TIPO[bloco.tipo]}`}
                  data-testid={`remover-${bloco.tipo}`}
                >
                  Remover
                </Button>
              </div>
            </div>

            <EditorDoBloco
              bloco={bloco}
              kioskDeviceId={kioskDeviceId}
              aoMudar={(atualizado) => {
                trocarItens(substituir(blocos.itens, atualizado));
              }}
              aoFalhar={aoFalhar}
            />
          </li>
        ))}
      </ol>

      {disponiveis.length > 0 ? (
        <div className={estilos['acrescentar']}>
          {disponiveis.map((tipo) => (
            <Button
              key={tipo}
              variant="outline"
              onClick={() => {
                trocarItens([...blocos.itens, blocoNovo(tipo, crypto.randomUUID())]);
              }}
              data-testid={`acrescentar-${tipo}`}
            >
              + {ROTULO_DO_TIPO[tipo]}
            </Button>
          ))}
        </div>
      ) : null}

      <FaixaDePatrocinio patrocinio={patrocinio} aoMudar={aoMudarPatrocinio} />
    </div>
  );
}

/** O editor de cada tipo. Um `switch` no lugar de cinco componentes soltos. */
function EditorDoBloco({
  bloco,
  kioskDeviceId,
  aoMudar,
  aoFalhar,
}: {
  readonly bloco: BlocoDaTelaPublica;
  readonly kioskDeviceId: string;
  readonly aoMudar: (bloco: BlocoDaTelaPublica) => void;
  readonly aoFalhar: (mensagem: string) => void;
}) {
  switch (bloco.tipo) {
    case 'VIDEO':
      return (
        <EditorDeVideo
          bloco={bloco}
          kioskDeviceId={kioskDeviceId}
          aoMudar={aoMudar}
          aoFalhar={aoFalhar}
        />
      );

    case 'EVENTOS':
      return <EditorDeEventos bloco={bloco} aoMudar={aoMudar} />;

    case 'MATERIAL':
      return (
        <>
          <Field
            id={`titulo-${bloco.id}`}
            label="Título"
            value={bloco.titulo}
            onChange={(e) => {
              aoMudar({ ...bloco, titulo: e.target.value });
            }}
          />
          <TextareaField
            id={`resumo-${bloco.id}`}
            label="Resumo"
            value={bloco.resumo}
            onChange={(e) => {
              aoMudar({ ...bloco, resumo: e.target.value });
            }}
          />
          <Field
            id={`urlDoQr-${bloco.id}`}
            label="Endereço do QR"
            type="url"
            value={bloco.urlDoQr}
            onChange={(e) => {
              aoMudar({ ...bloco, urlDoQr: e.target.value });
            }}
            hint="Quem estiver na recepção lê no próprio celular."
          />
        </>
      );

    case 'INSTAGRAM':
      return (
        <>
          <Field
            id={`perfil-${bloco.id}`}
            label="Perfil"
            value={bloco.perfil}
            onChange={(e) => {
              aoMudar({ ...bloco, perfil: e.target.value });
            }}
          />
          <Field
            id={`chamada-${bloco.id}`}
            label="Chamada"
            value={bloco.chamada}
            onChange={(e) => {
              aoMudar({ ...bloco, chamada: e.target.value });
            }}
          />
        </>
      );

    case 'INFORMACOES':
      return (
        <>
          <Field
            id={`titulo-${bloco.id}`}
            label="Título"
            value={bloco.titulo}
            onChange={(e) => {
              aoMudar({ ...bloco, titulo: e.target.value });
            }}
          />

          <div className={estilos['campoBooleano']}>
            <label htmlFor={`checkins-${bloco.id}`}>Check-ins de hoje</label>
            <input
              id={`checkins-${bloco.id}`}
              type="checkbox"
              checked={bloco.mostrarCheckinsDeHoje}
              onChange={(e) => {
                aoMudar({ ...bloco, mostrarCheckinsDeHoje: e.target.checked });
              }}
            />
          </div>

          <div className={estilos['campoBooleano']}>
            <label htmlFor={`treinando-${bloco.id}`}>Treinando agora (estimativa)</label>
            <input
              id={`treinando-${bloco.id}`}
              type="checkbox"
              checked={bloco.mostrarTreinandoAgora}
              onChange={(e) => {
                aoMudar({ ...bloco, mostrarTreinandoAgora: e.target.checked });
              }}
            />
          </div>

          {/*
            A TELA PRECISA DIZER QUE E ESTIMATIVA: a catraca registra entrada
            e nao saida, entao "treinando agora" e quem entrou nas ultimas
            horas. Prometer contagem exata na recepcao, ao lado de
            patrocinador, seria prometer o que o dado nao sustenta.
          */}
          <p className={estilos['dica']}>
            Os números vêm dos acessos desta unidade e são atualizados sozinhos. &quot;Treinando
            agora&quot; é uma estimativa: conta quem entrou nas últimas horas, porque a catraca
            registra a entrada e não a saída.
          </p>
        </>
      );
  }
}

function EditorDeVideo({
  bloco,
  kioskDeviceId,
  aoMudar,
  aoFalhar,
}: {
  readonly bloco: Extract<BlocoDaTelaPublica, { tipo: 'VIDEO' }>;
  readonly kioskDeviceId: string;
  readonly aoMudar: (bloco: BlocoDaTelaPublica) => void;
  readonly aoFalhar: (mensagem: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const campoDeArquivo = useRef<HTMLInputElement>(null);

  const enviar = async (arquivo: File) => {
    setEnviando(true);

    const dados = new FormData();

    dados.set('file', arquivo);

    const resultado = await enviarMidiaAction(kioskDeviceId, dados);

    setEnviando(false);

    if (resultado.erro !== undefined) {
      aoFalhar(resultado.erro);

      // Limpa o campo: deixar o nome do arquivo recusado ali sugere que ele
      // foi aceito, e o gerente sai da tela achando que publicou video.
      if (campoDeArquivo.current) campoDeArquivo.current.value = '';

      return;
    }

    aoMudar({ ...bloco, midiaKey: resultado.midiaKey ?? null });
  };

  return (
    <>
      <Field
        id={`titulo-${bloco.id}`}
        label="Título"
        value={bloco.titulo}
        onChange={(e) => {
          aoMudar({ ...bloco, titulo: e.target.value });
        }}
      />

      <Field
        id={`legenda-${bloco.id}`}
        label="Legenda"
        value={bloco.legenda}
        onChange={(e) => {
          aoMudar({ ...bloco, legenda: e.target.value });
        }}
        hint="O vídeo toca sem som — a legenda é o que comunica na recepção."
      />

      <div className={estilos['campoDeArquivo']}>
        <label htmlFor={`midia-${bloco.id}`}>Arquivo de vídeo (MP4, até 40 MB)</label>
        <input
          ref={campoDeArquivo}
          id={`midia-${bloco.id}`}
          type="file"
          accept="video/mp4"
          disabled={enviando}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];

            if (arquivo) void enviar(arquivo);
          }}
          data-testid={`midia-${bloco.id}`}
        />
        <span className={estilos['dica']} data-testid={`estado-midia-${bloco.id}`}>
          {enviando
            ? 'Enviando…'
            : bloco.midiaKey
              ? 'Vídeo enviado.'
              : 'Nenhum vídeo enviado ainda.'}
        </span>
      </div>

      {/*
        O CAMPO DE LINK EXISTE E ESTA DESABILITADO, com o motivo em tela.
        Esconde-lo faria o gerente concluir que a origem nunca existiu; a
        Decisao 7 do ADR-042 pediu as duas origens, e o que falta e o
        extrator, nao a decisao.
      */}
      <Field
        id={`linkExterno-${bloco.id}`}
        label="Link de reel do Instagram"
        type="url"
        value={bloco.linkExterno ?? ''}
        disabled
        onChange={(e) => {
          aoMudar({ ...bloco, linkExterno: e.target.value || null });
        }}
        hint="Indisponível nesta versão. Quando estiver, a mídia será copiada no momento de salvar — mudanças posteriores no Instagram não se refletem no totem."
        data-testid={`link-${bloco.id}`}
      />
    </>
  );
}

function EditorDeEventos({
  bloco,
  aoMudar,
}: {
  readonly bloco: Extract<BlocoDaTelaPublica, { tipo: 'EVENTOS' }>;
  readonly aoMudar: (bloco: BlocoDaTelaPublica) => void;
}) {
  const MAXIMO = 4;

  return (
    <>
      <Field
        id={`titulo-${bloco.id}`}
        label="Título"
        value={bloco.titulo}
        onChange={(e) => {
          aoMudar({ ...bloco, titulo: e.target.value });
        }}
      />

      {bloco.itens.map((evento, indice) => (
        <div key={indice} className={estilos['linhaDeEvento']}>
          <Field
            id={`evento-data-${bloco.id}-${indice}`}
            label="Data"
            type="date"
            value={evento.data}
            onChange={(e) => {
              aoMudar({
                ...bloco,
                itens: bloco.itens.map((atual, i) =>
                  i === indice ? { ...atual, data: e.target.value } : atual,
                ),
              });
            }}
          />

          <Field
            id={`evento-titulo-${bloco.id}-${indice}`}
            label="Evento"
            value={evento.titulo}
            onChange={(e) => {
              aoMudar({
                ...bloco,
                itens: bloco.itens.map((atual, i) =>
                  i === indice ? { ...atual, titulo: e.target.value } : atual,
                ),
              });
            }}
          />

          <Field
            id={`evento-info-${bloco.id}-${indice}`}
            label="Informação"
            value={evento.informacao}
            onChange={(e) => {
              aoMudar({
                ...bloco,
                itens: bloco.itens.map((atual, i) =>
                  i === indice ? { ...atual, informacao: e.target.value } : atual,
                ),
              });
            }}
          />

          <Button
            variant="ghost"
            onClick={() => {
              aoMudar({ ...bloco, itens: bloco.itens.filter((_, i) => i !== indice) });
            }}
            aria-label={`Remover evento ${indice + 1}`}
          >
            Remover
          </Button>
        </div>
      ))}

      {bloco.itens.length < MAXIMO ? (
        <Button
          variant="outline"
          onClick={() => {
            aoMudar({
              ...bloco,
              itens: [...bloco.itens, { data: '', titulo: '', informacao: '' }],
            });
          }}
          data-testid={`acrescentar-evento-${bloco.id}`}
        >
          + Evento
        </Button>
      ) : null}
    </>
  );
}

/**
 * Faixa de patrocinadores -- ADR-042, Decisao 4.
 *
 * VITRINE, NAO MIDIA. Nao ha campo de periodo, de clique, de campanha nem de
 * contador -- e a ausencia deles E a decisao, nao esquecimento. Acrescentar
 * qualquer um exige ADR proprio (o gatilho de revisao que a Decisao 4 escreve).
 */
function FaixaDePatrocinio({
  patrocinio,
  aoMudar,
}: {
  readonly patrocinio: KioskConfig['patrocinio'];
  readonly aoMudar: (patrocinio: KioskConfig['patrocinio']) => void;
}) {
  const cheia = patrocinio.marcas.length >= MAXIMO_DE_PATROCINADORES;

  return (
    <fieldset className={estilos['blocoDePatrocinio']}>
      <legend className={estilos['rotuloDoGrupo']}>Faixa de patrocinadores</legend>

      <div className={estilos['campoBooleano']}>
        <label htmlFor="patrocinioHabilitado">Exibir a faixa no rodapé</label>
        <input
          id="patrocinioHabilitado"
          type="checkbox"
          checked={patrocinio.habilitado}
          onChange={(e) => {
            aoMudar({ ...patrocinio, habilitado: e.target.checked });
          }}
          data-testid="campo-patrocinioHabilitado"
        />
      </div>

      {/*
        O ROTULO E OBRIGATORIO E NAO PODE SER ESVAZIADO -- publicidade
        identificada como tal (CDC art. 36), ao lado de conteudo informativo
        da propria academia. Campo vazio cai no padrao, e a dica mostra qual
        e antes de o gerente publicar e descobrir na tela.
      */}
      <Field
        id="rotuloDoPatrocinio"
        label="Rótulo da faixa"
        value={patrocinio.rotulo}
        onChange={(e) => {
          aoMudar({ ...patrocinio, rotulo: e.target.value });
        }}
        hint={`Em branco, o totem exibe "${rotuloDePatrocinio(patrocinio.rotulo)}". A faixa sempre leva rótulo.`}
        data-testid="campo-rotuloDoPatrocinio"
      />

      {patrocinio.marcas.map((marca, indice) => (
        <div key={indice} className={estilos['linhaDeEvento']}>
          <Field
            id={`patrocinador-nome-${indice}`}
            label="Nome"
            value={marca.nome}
            onChange={(e) => {
              aoMudar({
                ...patrocinio,
                marcas: patrocinio.marcas.map((atual, i) =>
                  i === indice ? { ...atual, nome: e.target.value } : atual,
                ),
              });
            }}
          />

          <Field
            id={`patrocinador-logo-${indice}`}
            label="URL do logotipo"
            type="url"
            value={marca.logotipoUrl ?? ''}
            onChange={(e) => {
              aoMudar({
                ...patrocinio,
                marcas: patrocinio.marcas.map((atual, i) =>
                  i === indice ? { ...atual, logotipoUrl: e.target.value || null } : atual,
                ),
              });
            }}
          />

          <Button
            variant="ghost"
            onClick={() => {
              aoMudar({
                ...patrocinio,
                marcas: patrocinio.marcas.filter((_, i) => i !== indice),
              });
            }}
            aria-label={`Remover patrocinador ${indice + 1}`}
          >
            Remover
          </Button>
        </div>
      ))}

      {cheia ? (
        <p className={estilos['dica']}>
          Limite de {MAXIMO_DE_PATROCINADORES} patrocinadores por unidade.
        </p>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            aoMudar({
              ...patrocinio,
              marcas: [...patrocinio.marcas, { nome: '', logotipoUrl: null }],
            });
          }}
          data-testid="acrescentar-patrocinador"
        >
          + Patrocinador
        </Button>
      )}
    </fieldset>
  );
}
