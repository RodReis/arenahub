'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { SelectField } from '@arenahub/ui';

import { CHAVES_DO_FILTRO } from '../../../../src/reports/filtro';
import estilos from '../../students/students.module.css';

const SITUACOES = [
  ['LEAD', 'Interessado'],
  ['TRIAL', 'Experimental'],
  ['ACTIVE', 'Ativo'],
  ['SUSPENDED', 'Suspenso'],
  ['BLOCKED', 'Bloqueado'],
  ['CANCELLED', 'Cancelado'],
  ['ARCHIVED', 'Arquivado'],
] as const;

const PERFIS = [
  ['STUDENT', 'Aluno'],
  ['TRAINER', 'Professor'],
  ['STAFF', 'Funcionário'],
  ['ADMIN', 'Administrador'],
  ['PERMUTA_TACIO', 'Permuta-Tacio'],
  ['PERMUTA_DOUGLAS', 'Permuta-Douglas'],
] as const;

type Chave = (typeof CHAVES_DO_FILTRO)[number];

interface Props {
  unidades: { id: string; name: string }[];
  /** Vazio quando o usuário não tem `plan.read`: o filtro simplesmente não aparece. */
  planos: { id: string; name: string }[];
  valores: Record<Chave, string>;
}

/**
 * Filtros do Relatório de Alunos. A URL é a fonte da verdade (link
 * compartilhável, botão voltar funciona); o componente só a reescreve. Sem
 * busca por texto, não há debounce: cada select navega na hora.
 *
 * Trocar qualquer filtro APAGA o `cursor`: ele aponta para uma posição da
 * lista ANTERIOR, e mantê-lo pularia ou repetiria gente.
 */
export function FiltroDoRelatorio({ unidades, planos, valores }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const trocar = (chave: Chave, valor: string): void => {
    const url = new URLSearchParams(searchParams.toString());

    url.delete('cursor');

    if (valor) url.set(chave, valor);
    else url.delete(chave);

    const consulta = url.toString();

    router.replace(consulta ? `${pathname}?${consulta}` : pathname, { scroll: false });
  };

  return (
    <div className={estilos['filtro']}>
      {unidades.length > 1 ? (
        <SelectField
          id="relatorio-unidade"
          name="gymUnitId"
          label="Unidade"
          value={valores.gymUnitId}
          onChange={(e) => trocar('gymUnitId', e.target.value)}
        >
          <option value="">Todas</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <SelectField
        id="relatorio-situacao"
        name="status"
        label="Situação"
        value={valores.status}
        onChange={(e) => trocar('status', e.target.value)}
      >
        <option value="">Todas</option>
        {SITUACOES.map(([chave, rotulo]) => (
          <option key={chave} value={chave}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      <SelectField
        id="relatorio-perfil"
        name="profile"
        label="Perfil"
        value={valores.profile}
        onChange={(e) => trocar('profile', e.target.value)}
      >
        <option value="">Todos</option>
        {PERFIS.map(([chave, rotulo]) => (
          <option key={chave} value={chave}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      {planos.length > 0 ? (
        <SelectField
          id="relatorio-plano"
          name="planId"
          label="Plano"
          value={valores.planId}
          onChange={(e) => trocar('planId', e.target.value)}
        >
          <option value="">Todos</option>
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <SelectField
        id="relatorio-financeiro"
        name="financeiro"
        label="Financeiro"
        value={valores.financeiro}
        onChange={(e) => trocar('financeiro', e.target.value)}
      >
        <option value="">Todos</option>
        <option value="INADIMPLENTES">Inadimplentes</option>
        <option value="PAGANTES">Pagantes</option>
      </SelectField>
    </div>
  );
}
