'use client';

import { useRef, useState } from 'react';

import { Button, DataTable, EmptyState, Icon, RowMenu, SectionCard } from '@arenahub/ui';

import { FormularioDeIndice } from './formulario-de-indice';
import estilos from './indices.module.css';

export interface ValorDeIndice {
  id: string;
  code: string;
  competencia: string;
  variationBasisPoints: number;
}

/** `440` -> `0,44%`. O banco guarda milésimos de ponto; o olho lê porcento. */
function porcento(basisPoints: number): string {
  const valor = (basisPoints / 1000).toFixed(2).replace('.', ',');

  return `${valor}%`;
}

/** `440` -> `0,44` — o mesmo número, sem o símbolo, para voltar ao campo. */
function paraCampo(basisPoints: number): string {
  return (basisPoints / 1000).toFixed(2).replace('.', ',');
}

/** `2026-03` -> `03/2026`. */
function competencia(mes: string): string {
  const [ano, numero] = mes.split('-');

  return `${numero}/${ano}`;
}

interface Props {
  readonly codigo: string;
  readonly valores: readonly ValorDeIndice[];
}

/**
 * Histórico do índice — tabela e formulário, com um estado só.
 *
 * CORRIGIR UM MÊS JÁ FUNCIONAVA e a tela não dizia: a API faz `upsert` por
 * `(code, competencia)`, então registrar março de novo substitui o valor de
 * março em vez de somar outra linha. É o desenho certo — o IBGE revisa —, mas
 * ninguém descobre isso digitando a mesma competência para ver o que acontece.
 * Agora a linha tem "Corrigir", e o formulário abre com o mês e o valor
 * atuais.
 *
 * NÃO HÁ APAGAR, e a ausência é honesta: a API não tem rota para isso, e o
 * valor do mês pode já ter corrigido um contrato. Remover a linha faria a
 * correção anual mudar de resultado sem nada avisando — o caminho é digitar o
 * valor certo por cima.
 */
export function HistoricoDoIndice({ codigo, valores }: Props) {
  const [corrigindo, setCorrigindo] = useState<ValorDeIndice | null>(null);
  const formulario = useRef<HTMLDivElement>(null);

  const corrigir = (valor: ValorDeIndice): void => {
    setCorrigindo(valor);
    formulario.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      {/*
        O AVISO VEM ANTES DA TABELA porque é ele que explica por que esta tela
        existe: sem o valor de um mês a correção anual não roda, e o contrato
        fica no valor anterior sem ninguém perceber.
      */}
      <p className={estilos['aviso']} data-testid="aviso-do-indice">
        <Icon name="alert-circle" />
        <span>
          O valor de cada mês é cadastrado à mão. A correção anual dos contratos fixos só roda
          quando todos os meses da janela estão aqui — faltando um, ela não roda e o contrato fica
          no valor anterior.
        </span>
      </p>

      <DataTable
        testId="tabela-de-indices"
        rows={valores}
        rowKey={(valor) => valor.id}
        caption={`Variação mensal do ${codigo}`}
        columns={[
          {
            key: 'competencia',
            header: 'Competência',
            role: 'code',
            render: (v) => competencia(v.competencia),
          },
          {
            key: 'variacao',
            header: 'Variação do mês',
            role: 'value',
            /*
              DEFLAÇÃO EM TOM PRÓPRIO, com o sinal continuando à vista: mês
              negativo é raro e é o que se confere duas vezes. A cor não é o
              canal — o `-` é; ela só evita que ele passe batido numa coluna de
              doze linhas quase iguais.
            */
            render: (v) => (
              <span
                className={estilos['variacao']}
                data-negativa={v.variationBasisPoints < 0 ? 'true' : undefined}
              >
                {porcento(v.variationBasisPoints)}
              </span>
            ),
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (v) => (
              <RowMenu
                label={`Ações de ${competencia(v.competencia)}`}
                testId="acoes-do-indice"
                itens={[
                  {
                    id: 'corrigir',
                    label: 'Corrigir variação',
                    icon: 'pencil',
                    onSelect: () => corrigir(v),
                  },
                ]}
              />
            ),
          },
        ]}
        empty={
          <EmptyState
            testId="indices-vazio"
            title={`Nenhum valor de ${codigo} cadastrado ainda.`}
            hint="Cadastre a variação de cada mês para que a correção anual dos contratos fixos possa rodar."
          />
        }
      />

      <div ref={formulario}>
        <SectionCard
          title={
            corrigindo === null
              ? 'Registrar variação do mês'
              : `Corrigir ${competencia(corrigindo.competencia)}`
          }
          icon="trending-up"
          summary={
            corrigindo === null
              ? 'Um mês por vez, como o IBGE publica.'
              : 'O valor novo substitui o atual. O IBGE revisa, e a segunda digitação é a que vale.'
          }
          testId="formulario-de-indice"
          {...(corrigindo === null
            ? {}
            : {
                actions: (
                  <Button
                    variant="ghost"
                    onClick={() => setCorrigindo(null)}
                    data-testid="cancelar-correcao-do-indice"
                  >
                    Cancelar correção
                  </Button>
                ),
              })}
        >
          <FormularioDeIndice
            /*
              A COMPETÊNCIA É A CHAVE: sem remontar, o campo de mês ficaria com
              o valor da correção anterior -- `defaultValue` só é lido na
              montagem.
            */
            key={corrigindo?.id ?? 'novo'}
            codigo={codigo}
            corrigindo={
              corrigindo === null
                ? undefined
                : {
                    competencia: corrigindo.competencia,
                    variacao: paraCampo(corrigindo.variationBasisPoints),
                  }
            }
            onCancelar={() => setCorrigindo(null)}
          />
        </SectionCard>
      </div>
    </>
  );
}
