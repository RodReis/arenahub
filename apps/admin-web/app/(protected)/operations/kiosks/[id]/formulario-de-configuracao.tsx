'use client';

import { useState } from 'react';

import { ACCENTS_DO_TOTEM, type KioskConfig } from '@arenahub/api-contracts';
import { Button, Field, SelectField, useToast, useToastDeErro } from '@arenahub/ui';

import { Abas } from '../../../../../src/components/abas';
import { AbaDeBlocos } from './aba-de-blocos';
import {
  descartarAction,
  publicarAction,
  salvarRascunhoAction,
} from '../../../../actions/kiosk-config';
import estilos from './formulario-de-configuracao.module.css';

/** Espelha `EstadoDaConfiguracao` da Task 3 -- ver `kiosk-admin-config.service.ts`. */
export interface EstadoDaConfiguracao {
  readonly publicada: { version: number; config: KioskConfig } | null;
  readonly rascunho: { config: KioskConfig } | null;
  readonly efetiva: KioskConfig;
  readonly configVersion: number;
  readonly totemEmSessao: boolean;
}

interface Props {
  readonly estado: EstadoDaConfiguracao;
  readonly kioskDeviceId: string;
}

const DURACOES = [45, 60, 90, 120] as const;

const ROTULO_DO_ACCENT: Record<(typeof ACCENTS_DO_TOTEM)[number], string> = {
  AZUL: 'Azul',
  VERDE: 'Verde',
  LARANJA: 'Laranja',
  ROXO: 'Roxo',
};

/**
 * Base do rascunho em edicao: comeca do rascunho existente, ou da camada
 * efetiva (a que o totem exibe hoje) quando nao ha rascunho ainda -- editar
 * "do zero" reiniciaria campos que a unidade ja escolheu antes.
 */
function configInicial(estado: EstadoDaConfiguracao): KioskConfig {
  return estado.rascunho?.config ?? estado.efetiva;
}

/**
 * Personalizacao do totem -- F50, painel do gerente.
 *
 * TRES ABAS reaproveitando `Abas` (ficha do aluno / planos): todas ficam
 * montadas, so trocam de `hidden` -- sem isso, campo de uma aba escondida
 * some do estado ao trocar de aba, porque o rascunho e um so objeto
 * controlado por este componente, nao por `FormData` nativo.
 *
 * NAO E `<form action>`: a config tem tres secoes editaveis mais duas acoes
 * (Publicar, Descartar) que operam sobre o rascunho JA SALVO, nao sobre o que
 * esta no campo. Um unico envio nativo confundiria "salvar o que digitei" com
 * "promover o que ja esta salvo".
 */
export function FormularioDeConfiguracao({ estado, kioskDeviceId }: Props) {
  const [rascunho, setRascunho] = useState<KioskConfig>(configInicial(estado));
  const [salvando, setSalvando] = useState(false);
  const [publicando, setPublicando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /*
   * COMEÇA de `estado.rascunho`, mas NÃO fica preso a ele: salvar cria
   * rascunho na hora (Publicar/Descartar precisam aparecer sem esperar um
   * novo carregamento da página), e publicar/descartar o apagam. O
   * `revalidatePath` da Server Action invalida o cache do Next para a
   * PRÓXIMA navegação -- esta árvore já montada só sabe da mudança porque
   * ela mesma marca o estado.
   */
  const [temRascunho, setTemRascunho] = useState(estado.rascunho !== null);
  const { show } = useToast();

  useToastDeErro(erro, 'error', 'erro-de-configuracao');

  const atualizarMarca = (campo: keyof KioskConfig['marca'], valor: string) => {
    setRascunho((atual) => ({
      ...atual,
      marca: { ...atual.marca, [campo]: campo === 'logotipoUrl' ? valor || null : valor },
    }));
  };

  const atualizarAparencia = <K extends keyof KioskConfig['aparencia']>(
    campo: K,
    valor: KioskConfig['aparencia'][K],
  ) => {
    setRascunho((atual) => ({ ...atual, aparencia: { ...atual.aparencia, [campo]: valor } }));
  };

  const atualizarSessao = <K extends keyof KioskConfig['sessao']>(
    campo: K,
    valor: KioskConfig['sessao'][K],
  ) => {
    setRascunho((atual) => ({ ...atual, sessao: { ...atual.sessao, [campo]: valor } }));
  };

  // Secoes INTEIRAS, e nao campo a campo: `blocos` e `patrocinio` carregam
  // lista ordenada, e um setter por campo obrigaria a aba a remontar o
  // objeto de qualquer jeito.
  const atualizarBlocos = (blocos: KioskConfig['blocos']) => {
    setRascunho((atual) => ({ ...atual, blocos }));
  };

  const atualizarPatrocinio = (patrocinio: KioskConfig['patrocinio']) => {
    setRascunho((atual) => ({ ...atual, patrocinio }));
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);

    const resultado = await salvarRascunhoAction(kioskDeviceId, rascunho);

    setSalvando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }

    setTemRascunho(true);
    show('info', 'Rascunho salvo.', 'rascunho-salvo');
  };

  const publicar = async () => {
    setPublicando(true);
    setErro(null);

    const resultado = await publicarAction(kioskDeviceId);

    setPublicando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }

    setTemRascunho(false);
    show('info', 'Configuração publicada.', 'configuracao-publicada');
  };

  const descartar = async () => {
    // Destrutivo e sem desfazer -- ver `window.confirm` abaixo. O teste de
    // componente nao aciona este caminho (jsdom nao tem `confirm` real sem
    // dublê), entao a chamada em si fica coberta pelo E2E da Task 6.
    if (!window.confirm('Descartar o rascunho? Esta ação não pode ser desfeita.')) return;

    setDescartando(true);
    setErro(null);

    const resultado = await descartarAction(kioskDeviceId);

    setDescartando(false);

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }

    setRascunho(estado.efetiva);
    setTemRascunho(false);
    show('info', 'Rascunho descartado.', 'rascunho-descartado');
  };

  return (
    <div className={estilos['pagina']}>
      {/*
        BARRA DE ESTADO FIXA -- os tres estados que a operacao precisa
        distinguir de relance: nada para publicar, algo esperando publicacao,
        e publicacao que o totem ainda nao pode aplicar porque um aluno esta
        no meio da sessao.
      */}
      <p aria-live="polite" className={estilos['barraDeEstado']} data-testid="barra-de-estado">
        {estado.totemEmSessao && temRascunho
          ? 'Rascunho pronto — aguardando o totem ficar livre para publicar.'
          : temRascunho
            ? 'Rascunho não publicado.'
            : 'Sem alterações — configuração publicada é a que o totem exibe.'}
      </p>

      <Abas
        rotulo="Seções da personalização do totem"
        abas={[
          {
            id: 'marca',
            rotulo: 'Marca',
            conteudo: (
              <div className={estilos['secao']}>
                <Field
                  id="nomeDaAcademia"
                  label="Nome da academia"
                  value={rascunho.marca.nomeDaAcademia}
                  onChange={(e) => atualizarMarca('nomeDaAcademia', e.target.value)}
                  data-testid="campo-nomeDaAcademia"
                />

                <Field
                  id="nomeDaUnidade"
                  label="Nome da unidade"
                  value={rascunho.marca.nomeDaUnidade}
                  onChange={(e) => atualizarMarca('nomeDaUnidade', e.target.value)}
                  data-testid="campo-nomeDaUnidade"
                />

                <Field
                  id="slogan"
                  label="Slogan"
                  value={rascunho.marca.slogan}
                  onChange={(e) => atualizarMarca('slogan', e.target.value)}
                  data-testid="campo-slogan"
                  {...(estado.rascunho === null && estado.efetiva.marca.slogan
                    ? {
                        hint: `Herdado da configuração vigente: "${estado.efetiva.marca.slogan}".`,
                      }
                    : {})}
                />

                <Field
                  id="logotipoUrl"
                  label="URL do logotipo"
                  type="url"
                  value={rascunho.marca.logotipoUrl ?? ''}
                  onChange={(e) => atualizarMarca('logotipoUrl', e.target.value)}
                  hint="Deixe em branco para usar a assinatura padrão do ArenaHub."
                  data-testid="campo-logotipoUrl"
                />
              </div>
            ),
          },
          {
            id: 'aparencia',
            rotulo: 'Aparência',
            conteudo: (
              <div className={estilos['secao']}>
                {/*
                  ACCENT COMO ESCOLHA ENTRE QUATRO, NUNCA HEX LIVRE --
                  ADR-042 Decisao 6. `radiogroup`/`radio` nativos: teclado e
                  leitor de tela ja funcionam sem reimplementar nada.
                */}
                <fieldset className={estilos['grupoDeAccent']}>
                  <legend className={estilos['rotuloDoGrupo']}>Cor de destaque</legend>

                  <div role="radiogroup" aria-label="Cor de destaque" className={estilos['amostras']}>
                    {ACCENTS_DO_TOTEM.map((accent) => (
                      <label key={accent} className={estilos['amostra']} data-accent={accent}>
                        <input
                          type="radio"
                          name="accent"
                          value={accent}
                          checked={rascunho.aparencia.accent === accent}
                          onChange={() => atualizarAparencia('accent', accent)}
                        />
                        <span className={estilos['pastilha']} data-accent={accent} aria-hidden="true" />
                        {ROTULO_DO_ACCENT[accent]}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className={estilos['campoBooleano']}>
                  <label htmlFor="altoContrastePadrao">
                    Alto contraste ligado por padrão (ao ligar o totem)
                  </label>
                  <input
                    id="altoContrastePadrao"
                    type="checkbox"
                    checked={rascunho.aparencia.altoContrastePadrao}
                    onChange={(e) => atualizarAparencia('altoContrastePadrao', e.target.checked)}
                    data-testid="campo-altoContrastePadrao"
                  />
                </div>

                {/*
                  A FRASE QUE O DESIGN EXIGE: o botao do aluno, na tela do
                  totem, sempre VENCE este padrao de boot -- inclusive
                  quando esta ligado aqui e o aluno desliga na sessao dele.
                */}
                <p className={estilos['dica']}>
                  Este é o padrão ao ligar o totem. Durante a sessão, o botão de alto contraste do
                  próprio aluno sempre vence — prevalece sobre este padrão da unidade.
                </p>
              </div>
            ),
          },
          {
            id: 'blocos',
            rotulo: 'Blocos públicos',
            conteudo: (
              <AbaDeBlocos
                rascunho={rascunho}
                kioskDeviceId={kioskDeviceId}
                aoMudarBlocos={atualizarBlocos}
                aoMudarPatrocinio={atualizarPatrocinio}
                aoFalhar={setErro}
              />
            ),
          },
          {
            id: 'sessao',
            rotulo: 'Sessão',
            conteudo: (
              <div className={estilos['secao']}>
                <SelectField
                  id="duracaoSegundos"
                  label="Duração da sessão"
                  value={String(rascunho.sessao.duracaoSegundos)}
                  onChange={(e) =>
                    atualizarSessao(
                      'duracaoSegundos',
                      Number(e.target.value) as KioskConfig['sessao']['duracaoSegundos'],
                    )
                  }
                  data-testid="campo-duracaoSegundos"
                >
                  {DURACOES.map((segundos) => (
                    <option key={segundos} value={segundos}>
                      {segundos} s
                    </option>
                  ))}
                </SelectField>

                {/*
                  INCREMENTO E TETO SAO `z.literal` NO CONTRATO -- nunca
                  mudam, entao viram TEXTO, nao campo. Um `<input>` editavel
                  aqui prometeria uma personalizacao que a API rejeitaria.
                */}
                <div className={estilos['valorFixo']}>
                  <span className={estilos['rotuloFixo']}>Incremento por toque</span>
                  <span data-testid="incremento-fixo">{rascunho.sessao.incrementoSegundos} s</span>
                </div>

                <div className={estilos['valorFixo']}>
                  <span className={estilos['rotuloFixo']}>Teto da sessão</span>
                  <span data-testid="teto-fixo">{rascunho.sessao.tetoSegundos} s</span>
                </div>

                <div className={estilos['campoBooleano']}>
                  <label htmlFor="avisoSonoroNaRecusa">Aviso sonoro quando o acesso é recusado</label>
                  <input
                    id="avisoSonoroNaRecusa"
                    type="checkbox"
                    checked={rascunho.sessao.avisoSonoroNaRecusa}
                    onChange={(e) => atualizarSessao('avisoSonoroNaRecusa', e.target.checked)}
                    data-testid="campo-avisoSonoroNaRecusa"
                  />
                </div>
              </div>
            ),
          },
        ]}
      />

      <div className={estilos['acoes']}>
        <Button onClick={() => void salvar()} disabled={salvando} data-testid="salvar-rascunho">
          {salvando ? 'Salvando…' : 'Salvar rascunho'}
        </Button>

        {temRascunho ? (
          <>
            <Button
              onClick={() => void publicar()}
              disabled={publicando}
              data-testid="publicar-configuracao"
            >
              {publicando ? 'Publicando…' : 'Publicar'}
            </Button>

            <Button
              variant="destructive"
              onClick={() => void descartar()}
              disabled={descartando}
              data-testid="descartar-rascunho"
            >
              {descartando ? 'Descartando…' : 'Descartar rascunho'}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
