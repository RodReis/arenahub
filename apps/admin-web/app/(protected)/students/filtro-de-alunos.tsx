'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Field, SelectField } from '@arenahub/ui';

import estilos from './students.module.css';

const SITUACOES = [
  ['LEAD', 'Interessado'],
  ['TRIAL', 'Experimental'],
  ['ACTIVE', 'Ativo'],
  ['SUSPENDED', 'Suspenso'],
  ['BLOCKED', 'Bloqueado'],
  ['CANCELLED', 'Cancelado'],
  ['ARCHIVED', 'Arquivado'],
] as const;

/** Não busca com menos de 3 caracteres — o mesmo piso do mockup (issue #118). */
const MINIMO_DE_CARACTERES = 3;
const ATRASO_MS = 300;

interface Props {
  unidades: { id: string; name: string }[];
  /** Modalidades ATIVAS de todas as unidades do tenant -- F60. */
  modalidades: { id: string; gymUnitId: string; name: string }[];
  termoInicial: string;
  situacaoInicial: string;
  unidadeInicial: string;
  modalidadeInicial: string;
}

/**
 * Filtro da tela de Alunos — issue #118.
 *
 * SUBSTITUI o `<form method="get">`: a busca por texto dispara sozinha 300ms
 * depois de parar de digitar (3+ caracteres), e a situação dispara na hora.
 * Não há botão "Filtrar" — o pedido do PI foi explícito.
 *
 * A URL continua sendo a fonte da verdade (mesma razão de antes: link
 * compartilhável, botão voltar funciona, sem estado que se perde). O que
 * muda é QUEM escreve nela: antes era o navegador ao enviar o form, agora é
 * `router.replace`, sem adicionar entrada no histórico a cada tecla.
 */
export function FiltroDeAlunos({
  unidades,
  modalidades,
  termoInicial,
  situacaoInicial,
  unidadeInicial,
  modalidadeInicial,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [termo, setTermo] = useState(termoInicial);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * O ultimo termo que a pessoa REALMENTE buscou -- issue #263.
   *
   * `useEffect` roda na MONTAGEM, e nao so quando `termo` muda. Sem esta
   * comparacao, chegar na pagina 2 pelo link "Proximos" montava o
   * componente, disparava `navegar` 300 ms depois e `url.delete('cursor')`
   * devolvia a pessoa para a PAGINA 1 -- sozinho, sem ninguem tocar em nada.
   * A recepcao via a lista "voltar" enquanto lia, e paginar era impossivel.
   *
   * GUARDA O VALOR, e nao um booleano "ja montou". A diferenca nao e estilo:
   * `reactStrictMode` esta ligado (`next.config.ts`) e monta cada componente
   * DUAS vezes em desenvolvimento, entao um sinalizador de primeira execucao
   * e derrubado pela segunda montagem -- e foi exatamente assim que a
   * primeira versao desta correcao passou no teste de unidade (onde `render`
   * nao simula Strict Mode) e continuou falhando no navegador, pego pelo
   * E2E. Comparar valores e idempotente: montar dez vezes com o mesmo texto
   * nao dispara busca nenhuma.
   *
   * `useRef` e nao `useState`: mudar isto nao pode causar renderizacao, e o
   * valor tem de sobreviver entre renderizacoes sem participar de nenhuma.
   */
  const ultimoBuscado = useRef(termoInicial);

  const navegar = (
    proximoTermo: string,
    proximaSituacao: string,
    proximaUnidade: string,
    proximaModalidade: string,
  ): void => {
    const url = new URLSearchParams(searchParams.toString());

    url.delete('cursor');

    if (proximoTermo) url.set('q', proximoTermo);
    else url.delete('q');

    if (proximaSituacao) url.set('status', proximaSituacao);
    else url.delete('status');

    if (proximaUnidade) url.set('gymUnitId', proximaUnidade);
    else url.delete('gymUnitId');

    if (proximaModalidade) url.set('modalityId', proximaModalidade);
    else url.delete('modalityId');

    router.replace(`${pathname}?${url.toString()}`, { scroll: false });
  };

  /**
   * As modalidades OFERECIDAS pelo filtro -- F60, decisao do PI (opcao B).
   *
   * Com unidade escolhida, so as dela; sem unidade, todas. Oferecer sempre a
   * lista inteira deixaria escolher a combinacao unidade A + modalidade da
   * unidade B, que so devolve lista vazia -- e a recepcao acharia que nao ha
   * ninguem, quando na verdade a pergunta e que era impossivel.
   *
   * Derivado a cada renderizacao, sem `useMemo`: a lista tem poucas entradas,
   * e sincronizar por efeito seria estado duplicado que pode divergir do
   * select.
   */
  const modalidadesOferecidas = unidadeInicial
    ? modalidades.filter((m) => m.gymUnitId === unidadeInicial)
    : modalidades;

  /**
   * Trocar a unidade LIMPA a modalidade que nao e da nova unidade.
   *
   * Sem isto, filtrar por "Cross Fit" na unidade A e depois trocar para a B
   * manteria `modalityId` na URL apontando para modalidade que a B nao
   * oferece: a lista viria vazia e o combo mostraria "Todas", porque a opcao
   * escolhida nem existe mais entre as oferecidas. Some o filtro da tela e
   * fica o efeito -- o pior dos dois mundos.
   */
  const trocarUnidade = (proximaUnidade: string): void => {
    const continuaValida = modalidades.some(
      (m) => m.id === modalidadeInicial && (!proximaUnidade || m.gymUnitId === proximaUnidade),
    );

    navegar(termo, situacaoInicial, proximaUnidade, continuaValida ? modalidadeInicial : '');
  };

  // Busca automática: só dispara com 3+ caracteres, ou quando o campo volta
  // a ficar vazio (para limpar o filtro sem digitar nada de novo).
  useEffect(() => {
    /*
     * TEXTO IGUAL AO ÚLTIMO BUSCADO NÃO É BUSCA (issue #263). A pessoa não
     * digitou nada -- ela apenas abriu a tela, possivelmente numa página 2
     * cujo `cursor` `navegar` apagaria, devolvendo-a à primeira.
     *
     * Compara VALOR, e não "é a primeira execução": o Strict Mode monta duas
     * vezes, e um sinalizador de montagem é derrubado pela segunda. Ver a
     * nota em `ultimoBuscado`.
     */
    if (termo === ultimoBuscado.current) return;

    if (termo.length > 0 && termo.length < MINIMO_DE_CARACTERES) return;

    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      // Só depois de disparar de fato: marcar antes faria um texto abandonado
      // no meio da digitação (que nunca chegou a buscar) bloquear a busca
      // real quando a pessoa voltasse a ele.
      ultimoBuscado.current = termo;
      navegar(termo, situacaoInicial, unidadeInicial, modalidadeInicial);
    }, ATRASO_MS);

    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só o texto redispara a busca; situação/unidade têm o próprio handler.
  }, [termo]);

  return (
    <div className={estilos['filtro']}>
      <div className={estilos['busca']}>
        <Field
          id="busca"
          name="q"
          type="search"
          label="Buscar por nome, matrícula ou contato"
          value={termo}
          onChange={(evento) => setTermo(evento.target.value)}
          placeholder="Ex.: Maria, AP-2026-00000001, (41) 99999-0000"
          data-testid="busca-de-alunos"
        />
      </div>

      <SelectField
        id="situacao"
        name="status"
        label="Situação"
        value={situacaoInicial}
        onChange={(evento) => navegar(termo, evento.target.value, unidadeInicial, modalidadeInicial)}
      >
        <option value="">Todas</option>
        {SITUACOES.map(([chave, rotulo]) => (
          <option key={chave} value={chave}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      {unidades.length > 1 ? (
        <SelectField
          id="unidade"
          name="gymUnitId"
          label="Unidade"
          value={unidadeInicial}
          onChange={(evento) => trocarUnidade(evento.target.value)}
        >
          <option value="">Todas</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      {/*
        MODALIDADE (F60) -- academia, quadras de areia, cross fit.

        Aparece com UMA modalidade cadastrada, diferente do filtro de unidade
        logo acima, que exige duas: com uma unidade so, filtrar por ela nao
        separa ninguem; com uma modalidade so, separa quem a tem de quem nao
        a tem -- e quem nao tem e o funcionario, o personal e o administrador.

        A lista acompanha a unidade escolhida (decisao do PI): ver
        `modalidadesOferecidas`.
      */}
      {modalidadesOferecidas.length > 0 ? (
        <SelectField
          id="modalidade"
          name="modalityId"
          label="Modalidade"
          value={modalidadeInicial}
          onChange={(evento) =>
            navegar(termo, situacaoInicial, unidadeInicial, evento.target.value)
          }
          data-testid="filtro-de-modalidade"
        >
          <option value="">Todas</option>
          {modalidadesOferecidas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}
