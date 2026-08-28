'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';

import { Button, Field, SelectField, StateBadge, useToastDeErro } from '@arenahub/ui';

import {
  ativarDesafio,
  cancelarDesafio,
  criarDesafio,
  editarDesafio,
  excluirDesafio,
  type DesafioDaListagemDto,
  type EstadoDoDesafio,
  type TemplateDeDesafioDto,
} from '../../../actions/engagement';
import estilos from './desafios.module.css';

interface Unidade {
  readonly id: string;
  readonly name: string;
}

const ESTADO_INICIAL: EstadoDoDesafio = {};

/**
 * Espelham `podeEditar`/`podeExcluir` e `podeCancelar` do dominio da API.
 *
 * A GUARDA DE VERDADE E O SERVIDOR -- isto so evita mostrar botao que sempre
 * falharia. Divergir daquelas funcoes faz a tela prometer o que a API
 * recusa, entao qualquer mudanca la precisa vir aqui junto.
 */
function podeMexer(desafio: DesafioDaListagemDto): boolean {
  return (
    (desafio.status === 'DRAFT' || desafio.status === 'ACTIVE') && desafio.participantes === 0
  );
}

function podeCancelarNaTela(desafio: DesafioDaListagemDto): boolean {
  return desafio.status === 'DRAFT' || desafio.status === 'ACTIVE';
}



/** Dias entre duas datas locais, inclusivo -- o mesmo calculo do dominio. */
function diasEntre(inicio: string, fim: string): number {
  const t0 = Date.parse(`${inicio}T00:00:00.000Z`);
  const t1 = Date.parse(`${fim}T00:00:00.000Z`);

  if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;

  return (t1 - t0) / 86_400_000 + 1;
}

/**
 * Desafios -- F34, Slice 5.5, ADR-048.
 *
 * A TELA MOSTRA O TETO ANTES DE ENVIAR, e essa e a decisao de desenho: a API
 * recusa meta acima do limite do modelo (`M5-BR-011`), mas descobrir isso so
 * depois de preencher tudo faria a secretaria adivinhar o numero por
 * tentativa. O aviso e informativo -- a RECUSA continua sendo do servidor,
 * porque validacao de cliente nao e guarda.
 */
export function PainelDeDesafios({
  modelos,
  unidades,
  existentes,
}: {
  readonly modelos: readonly TemplateDeDesafioDto[];
  readonly unidades: readonly Unidade[];
  readonly existentes: readonly DesafioDaListagemDto[];
}) {
  const [estadoCriar, acaoCriar] = useActionState(criarDesafio, ESTADO_INICIAL);
  const [estadoAtivar, acaoAtivar] = useActionState(ativarDesafio, ESTADO_INICIAL);
  const [estadoEditar, acaoEditar] = useActionState(editarDesafio, ESTADO_INICIAL);
  const [estadoExcluir, acaoExcluir] = useActionState(excluirDesafio, ESTADO_INICIAL);
  const [estadoCancelar, acaoCancelar] = useActionState(cancelarDesafio, ESTADO_INICIAL);

  /** Qual desafio esta com o formulario de edicao aberto. */
  const [editando, setEditando] = useState<string | null>(null);
  const [enviando, iniciarEnvio] = useTransition();

  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? '');
  const [unidadeId, setUnidadeId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [meta, setMeta] = useState('8');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');

  useToastDeErro(estadoCriar.erro, 'error', 'erro-ao-criar-desafio');
  useToastDeErro(estadoAtivar.erro, 'error', 'erro-ao-abrir-desafio');
  useToastDeErro(estadoEditar.erro, 'error', 'erro-ao-editar-desafio');
  useToastDeErro(estadoExcluir.erro, 'error', 'erro-ao-excluir-desafio');
  useToastDeErro(estadoCancelar.erro, 'error', 'erro-ao-cancelar-desafio');

  const modelo = modelos.find((m) => m.id === modeloId);

  /**
   * Teto da janela escolhida: semanas parciais contam como semana, igual ao
   * `Math.ceil` do dominio. Numero diferente aqui e la faria a tela prometer
   * o que o servidor recusa.
   */
  const teto = useMemo(() => {
    if (!modelo || !inicio || !fim || fim < inicio) return null;

    const dias = diasEntre(inicio, fim);

    if (dias <= 0 || dias > modelo.maxJanelaEmDias) return null;

    return Math.ceil(dias / 7) * modelo.maxSessoesPorSemana;
  }, [modelo, inicio, fim]);

  const janelaLongaDemais =
    modelo !== undefined && inicio !== '' && fim !== '' && fim >= inicio
      ? diasEntre(inicio, fim) > modelo.maxJanelaEmDias
      : false;

  if (modelos.length === 0) {
    return (
      <p data-testid="sem-modelos">
        Nenhum modelo de desafio está disponível. Modelos definem o limite de treinos por semana
        e são cadastrados junto com o catálogo do produto.
      </p>
    );
  }

  return (
    <div className={estilos['grade']}>
      <form
        className={estilos['bloco']}
        action={(dados) => {
          iniciarEnvio(() => {
            acaoCriar(dados);
          });
        }}
      >
        <h2>Novo desafio</h2>

        <SelectField
          id="modelo-do-desafio"
          name="templateVersionId"
          label="Modelo"
          value={modeloId}
          disabled={enviando}
          onChange={(evento) => setModeloId(evento.target.value)}
        >
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — até {m.maxSessoesPorSemana} treinos por semana
            </option>
          ))}
        </SelectField>

        <SelectField
          id="unidade-do-desafio"
          name="gymUnitId"
          label="Unidade"
          value={unidadeId}
          disabled={enviando}
          onChange={(evento) => setUnidadeId(evento.target.value)}
        >
          {/* Vazio = todas. A API trata string vazia como `null`. */}
          <option value="">Todas as unidades</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>

        <Field
          id="titulo-do-desafio"
          name="title"
          label="Título"
          value={titulo}
          maxLength={120}
          disabled={enviando}
          onChange={(evento) => setTitulo(evento.target.value)}
        />

        <div className={estilos['periodo']}>
          <Field
            id="inicio-do-desafio"
            name="startsOn"
            label="Início"
            type="date"
            value={inicio}
            disabled={enviando}
            onChange={(evento) => setInicio(evento.target.value)}
          />
          <Field
            id="fim-do-desafio"
            name="endsOn"
            label="Fim"
            type="date"
            value={fim}
            disabled={enviando}
            onChange={(evento) => setFim(evento.target.value)}
          />
        </div>

        <Field
          id="meta-do-desafio"
          name="targetValue"
          label="Meta (treinos no período)"
          type="number"
          min={1}
          value={meta}
          disabled={enviando}
          onChange={(evento) => setMeta(evento.target.value)}
        />

        {janelaLongaDemais && modelo ? (
          <p data-testid="janela-longa-demais" className={estilos['aviso']}>
            Este modelo permite no máximo {modelo.maxJanelaEmDias} dias de período.
          </p>
        ) : null}

        {teto !== null ? (
          <p data-testid="teto-da-janela" className={estilos['aviso']}>
            Neste período, a meta pode ir até {teto} treinos.
          </p>
        ) : null}

        <Button type="submit" disabled={enviando}>
          Criar desafio
        </Button>
      </form>

      <div className={estilos['bloco']}>
        <h2>Desafios criados</h2>

        {existentes.length === 0 ? (
          <p data-testid="sem-desafio-criado">
            Nenhum desafio ainda. Crie um ao lado — ele nasce fechado, e você abre a inscrição
            quando estiver conferido.
          </p>
        ) : (
          <ul className={estilos['lista']} data-testid="lista-de-desafios">
            {existentes.map((desafio) => (
              <li key={desafio.id} className={estilos['item']} data-testid={`desafio-${desafio.id}`}>
                <div className={estilos['itemTexto']}>
                  <strong>{desafio.title}</strong>
                  <span className={estilos['aviso']}>
                    {desafio.templateName} · meta {desafio.targetValue} · {desafio.startsOn} a{' '}
                    {desafio.endsOn}
                    {desafio.status === 'ACTIVE' || desafio.status === 'CLOSED'
                      ? ` · ${String(desafio.participantes)} inscrito(s)`
                      : ''}
                  </span>
                </div>

                <div className={estilos['itemAcao']}>
                  <StateBadge machine="challenge" state={desafio.status} />

                  {desafio.status === 'DRAFT' ? (
                    <form
                      action={(dados) => {
                        iniciarEnvio(() => {
                          acaoAtivar(dados);
                        });
                      }}
                    >
                      <input type="hidden" name="challengeId" value={desafio.id} />
                      <Button type="submit" disabled={enviando}>
                        Abrir inscrição
                      </Button>
                    </form>
                  ) : null}

                  {/*
                    EDITAR e EXCLUIR so aparecem enquanto sao possiveis: com
                    aluno inscrito, a API recusa os dois (mudar a meta
                    alteraria o combinado; excluir apagaria o historico
                    dele). Mostrar botao que sempre falha treina a secretaria
                    a ignorar erro -- some, e sobra CANCELAR, que preserva.
                  */}
                  {podeMexer(desafio) ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={enviando}
                        onClick={() => setEditando(editando === desafio.id ? null : desafio.id)}
                        data-testid={`editar-${desafio.id}`}
                      >
                        {editando === desafio.id ? 'Cancelar edição' : 'Editar'}
                      </Button>

                      <form
                        action={(dados) => {
                          iniciarEnvio(() => {
                            acaoExcluir(dados);
                          });
                        }}
                      >
                        <input type="hidden" name="challengeId" value={desafio.id} />
                        <Button
                          type="submit"
                          variant="destructive"
                          disabled={enviando}
                          data-testid={`excluir-${desafio.id}`}
                        >
                          Excluir
                        </Button>
                      </form>
                    </>
                  ) : null}

                  {podeCancelarNaTela(desafio) ? (
                    <form
                      action={(dados) => {
                        iniciarEnvio(() => {
                          acaoCancelar(dados);
                        });
                      }}
                    >
                      <input type="hidden" name="challengeId" value={desafio.id} />
                      <Button
                        type="submit"
                        variant="destructive"
                        disabled={enviando}
                        data-testid={`cancelar-${desafio.id}`}
                      >
                        Cancelar desafio
                      </Button>
                    </form>
                  ) : null}
                </div>

                {editando === desafio.id ? (
                  <form
                    className={estilos['edicao']}
                    data-testid={`form-edicao-${desafio.id}`}
                    action={(dados) => {
                      iniciarEnvio(() => {
                        acaoEditar(dados);
                        setEditando(null);
                      });
                    }}
                  >
                    <input type="hidden" name="challengeId" value={desafio.id} />

                    <Field
                      id={`titulo-${desafio.id}`}
                      name="title"
                      label="Título"
                      defaultValue={desafio.title}
                      maxLength={120}
                      disabled={enviando}
                    />

                    <div className={estilos['periodo']}>
                      <Field
                        id={`inicio-${desafio.id}`}
                        name="startsOn"
                        label="Início"
                        type="date"
                        defaultValue={desafio.startsOn}
                        disabled={enviando}
                      />
                      <Field
                        id={`fim-${desafio.id}`}
                        name="endsOn"
                        label="Fim"
                        type="date"
                        defaultValue={desafio.endsOn}
                        disabled={enviando}
                      />
                    </div>

                    <Field
                      id={`meta-${desafio.id}`}
                      name="targetValue"
                      label="Meta (treinos no período)"
                      type="number"
                      min={1}
                      defaultValue={String(desafio.targetValue)}
                      disabled={enviando}
                    />

                    {/*
                      O MODELO NAO E EDITAVEL: troca-lo trocaria o teto de
                      seguranca por baixo de um desafio ja criado, e o limite
                      foi validado contra o modelo original. Trocar de modelo
                      e criar outro desafio.
                    */}
                    <p className={estilos['aviso']}>
                      Modelo: {desafio.templateName} — para trocar de modelo, crie outro desafio.
                    </p>

                    <Button type="submit" disabled={enviando}>
                      Salvar
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
