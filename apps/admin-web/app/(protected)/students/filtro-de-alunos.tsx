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
  termoInicial: string;
  situacaoInicial: string;
  unidadeInicial: string;
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
export function FiltroDeAlunos({ unidades, termoInicial, situacaoInicial, unidadeInicial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [termo, setTermo] = useState(termoInicial);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const navegar = (proximoTermo: string, proximaSituacao: string, proximaUnidade: string): void => {
    const url = new URLSearchParams(searchParams.toString());

    url.delete('cursor');

    if (proximoTermo) url.set('q', proximoTermo);
    else url.delete('q');

    if (proximaSituacao) url.set('status', proximaSituacao);
    else url.delete('status');

    if (proximaUnidade) url.set('gymUnitId', proximaUnidade);
    else url.delete('gymUnitId');

    router.replace(`${pathname}?${url.toString()}`, { scroll: false });
  };

  // Busca automática: só dispara com 3+ caracteres, ou quando o campo volta
  // a ficar vazio (para limpar o filtro sem digitar nada de novo).
  useEffect(() => {
    if (termo.length > 0 && termo.length < MINIMO_DE_CARACTERES) return;

    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      navegar(termo, situacaoInicial, unidadeInicial);
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
        onChange={(evento) => navegar(termo, evento.target.value, unidadeInicial)}
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
          onChange={(evento) => navegar(termo, situacaoInicial, evento.target.value)}
        >
          <option value="">Todas</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}
