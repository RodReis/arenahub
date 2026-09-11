'use client';

import { useRef, useState } from 'react';

import {
  Button,
  DataTable,
  EmptyState,
  EstadoSimples,
  Icon,
  Money,
  SectionCard,
} from '@arenahub/ui';

import { AcoesDoPlano } from './acoes-do-plano';
import { FormularioDePlano } from './formulario-de-plano';
import estilos from './planos.module.css';

/** O que `GET /api/v1/platform/plans` devolve. */
export interface PlanoNaLista {
  id: string;
  name: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  fixedPriceMinor: number | null;
  currency: string;
  status: 'ACTIVE' | 'ARCHIVED';
  mobileEnabled: boolean;
  kioskEnabled: boolean;
}

/**
 * O preço do plano, escrito conforme o modelo.
 *
 * DUAS LINHAS no modelo por aluno, e não uma soma: ativo e inativo são preços
 * distintos e negociados separadamente (ADR-052 §6). Somá-los ou mostrar só um
 * esconderia metade da tabela de preço de quem está escolhendo.
 */
function preco(plano: PlanoNaLista) {
  if (plano.model === 'FIXED_MONTHLY') {
    return <Money cents={plano.fixedPriceMinor} currency={plano.currency} />;
  }

  return (
    <>
      <div>
        <Money cents={plano.activeStudentPriceMinor} currency={plano.currency} /> por ativo
      </div>
      <div>
        <Money cents={plano.inactiveStudentPriceMinor} currency={plano.currency} /> por inativo
      </div>
    </>
  );
}

/**
 * Catálogo de planos — tabela e formulário, que compartilham um estado só.
 *
 * CLIENT COMPONENT SÓ PELA LIGAÇÃO: "Editar" na linha precisa preencher o
 * formulário abaixo, e isso é estado que vive entre os dois. A busca continua
 * na página, que é Server Component — aqui não há `fetch` nenhum.
 *
 * A LISTA É A CHAVE DO FORMULÁRIO. Trocar de plano em edição sem remontar o
 * formulário deixaria os campos com os valores do plano anterior: eles são
 * `defaultValue`, e `defaultValue` só é lido na montagem. A `key` força o
 * React a montar de novo — é a mesma técnica que a pré-visualização da marca
 * usa para o navegador rebuscar a imagem.
 */
export function CatalogoDePlanos({ planos }: { readonly planos: readonly PlanoNaLista[] }) {
  const [editando, setEditando] = useState<PlanoNaLista | null>(null);
  const formulario = useRef<HTMLDivElement>(null);

  const editar = (plano: PlanoNaLista): void => {
    setEditando(plano);

    /*
      O FORMULÁRIO ESTÁ ABAIXO DA TABELA, e numa lista de dez planos ele fica
      fora da tela. Sem rolar até ele, "Editar" pareceria não fazer nada.
      `smooth` respeita `prefers-reduced-motion` por conta do navegador.
    */
    formulario.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      {/*
        O AVISO VEM ANTES DA TABELA, e não como rodapé: é a regra que faz esta
        tela não ser o que ela parece. Quem reajusta o catálogo acreditaria
        estar reajustando os clientes, e descobriria o contrário na fatura.
      */}
      <p className={estilos['aviso']} data-testid="aviso-de-catalogo">
        <Icon name="alert-circle" />
        <span>
          Alterar o preço de um plano não muda contrato já fechado. Os contratos guardam os valores
          acordados no fechamento — o preço novo vale para os próximos.
        </span>
      </p>

      <DataTable
        testId="tabela-de-planos"
        rows={planos}
        rowKey={(plano) => plano.id}
        caption="Planos SaaS oferecidos aos clientes"
        columns={[
          { key: 'nome', header: 'Plano', role: 'identity', render: (p) => p.name },
          {
            key: 'modelo',
            header: 'Modelo',
            role: 'label',
            render: (p) => (p.model === 'PER_STUDENT' ? 'Por aluno' : 'Fixo mensal'),
          },
          { key: 'preco', header: 'Preço mensal', role: 'value', render: preco },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            render: (p) =>
              p.status === 'ACTIVE' ? (
                <EstadoSimples label="Ativo" tom="positivo" />
              ) : (
                <EstadoSimples label="Arquivado" tom="neutro" />
              ),
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (p) => (
              <AcoesDoPlano
                planoId={p.id}
                nome={p.name}
                status={p.status}
                onEditar={() => editar(p)}
              />
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="planos-vazio"
            title="Nenhum plano cadastrado ainda."
            hint="Cadastre o primeiro plano para poder fechar contrato com um cliente."
          />
        }
      />

      <div ref={formulario}>
        <SectionCard
          title={editando === null ? 'Novo plano' : `Editar ${editando.name}`}
          icon="trending-up"
          summary={
            editando === null
              ? 'Entra no catálogo disponível para contrato novo.'
              : 'Alterar o preço aqui não muda contrato já fechado — ele vale para os próximos.'
          }
          testId="formulario-de-plano"
          {...(editando === null
            ? {}
            : {
                actions: (
                  <Button
                    variant="ghost"
                    onClick={() => setEditando(null)}
                    data-testid="cancelar-edicao-do-plano"
                  >
                    Cancelar edição
                  </Button>
                ),
              })}
        >
          <FormularioDePlano key={editando?.id ?? 'novo'} plano={editando} />
        </SectionCard>
      </div>

    </>
  );
}
