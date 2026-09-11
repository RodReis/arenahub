'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  EmptyState,
  Field,
  SectionCard,
  SelectField,
  useToastDeErro,
} from '@arenahub/ui';

import estilos from '../../../../formulario.module.css';
import proprios from './contratos.module.css';

import { criarContrato, type EstadoDoContrato } from '../../../../actions/contratos';

const ESTADO_INICIAL: EstadoDoContrato = {};

interface PlanoParaEscolher {
  id: string;
  name: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  mobileEnabled: boolean;
  kioskEnabled: boolean;
}

interface Props {
  readonly tenantId: string;
  readonly planos: readonly PlanoParaEscolher[];
  /**
   * Já existe contrato vigente? Decide se o formulário nasce aberto.
   *
   * O BANCO SÓ ADMITE UM CONTRATO ATIVO POR CLIENTE (índice parcial, ADR-052
   * §8). Com um vigente, o formulário sempre aberto oferecia um segundo
   * contrato que a API recusaria depois de a pessoa preencher oito campos.
   */
  readonly temVigente: boolean;
}

function BotaoDeAbrir() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-contrato">
      {pending ? 'Abrindo…' : 'Abrir contrato'}
    </Button>
  );
}

/**
 * Abertura de contrato — F63, ADR-052 §8.
 *
 * O CONTRATO NASCE EM RASCUNHO, e a tela diz isso: fechar é um segundo ato, com
 * botão próprio na linha da tabela. Abrir e fechar no mesmo clique tornaria
 * irreversível um formulário que ainda se está preenchendo — a partir de
 * `ACTIVE` o registro é imutável, e corrigir um dia errado exigiria contrato
 * novo.
 *
 * OS CAMPOS DE REAJUSTE SÓ APARECEM NO PLANO FIXO. Preço por aluno acompanha o
 * catálogo do próximo contrato, não um índice — pedir índice e aniversário
 * neles faria a pessoa preencher um dado que nada lê.
 */
export function FormularioDeContrato({ tenantId, planos, temVigente }: Props) {
  const [estado, acao] = useActionState(criarContrato, ESTADO_INICIAL);
  /*
   * Aberto quando NÃO há vigente -- abrir contrato é o que se veio fazer numa
   * lista vazia. Com vigente, pede um clique: o segundo contrato existe (é
   * assim que se reajusta), mas ele começa por encerrar o atual.
   */
  const [aberto, setAberto] = useState(!temVigente);
  const [planoId, setPlanoId] = useState(planos[0]?.id ?? '');
  /*
   * O início é CONTROLADO porque o plano por aluno reaproveita o valor dele
   * como data-base num campo escondido. Lê-lo de `estado.valores` só
   * funcionaria depois de um erro -- na primeira submissão iria vazio, e a API
   * recusaria um formulário que a pessoa preencheu inteiro.
   */
  const [inicio, setInicio] = useState(estado.valores?.['startsAt'] ?? '');

  useToastDeErro(estado.erro, 'error', 'erro-do-contrato');

  if (planos.length === 0) {
    return (
      <EmptyState
        testId="sem-plano-para-contrato"
        title="Nenhum plano ativo no catálogo."
        hint="Cadastre um plano SaaS antes de abrir contrato com este cliente."
        action={
          <Button href="/platform/planos" data-testid="ir-para-planos">
            Ver planos
          </Button>
        }
      />
    );
  }

  const escolhido = planos.find((plano) => plano.id === planoId) ?? planos[0];
  const fixo = escolhido?.model === 'FIXED_MONTHLY';

  if (!aberto) {
    return (
      <div className={proprios['convite']}>
        <p className={estilos['nota']}>
          Este cliente já tem contrato vigente. Abrir outro exige encerrar o atual primeiro — o
          banco só admite um contrato ativo por cliente.
        </p>
        <Button variant="outline" onClick={() => setAberto(true)} data-testid="abrir-novo-contrato">
          Preparar contrato novo
        </Button>
      </div>
    );
  }

  return (
    <SectionCard
      title="Novo contrato"
      icon="file-text"
      summary="Nasce em rascunho. Fechar é um segundo ato — a partir dele o contrato é imutável e o PDF existe."
      testId="novo-contrato"
      {...(temVigente
        ? {
            actions: (
              <Button variant="ghost" onClick={() => setAberto(false)} data-testid="cancelar-contrato">
                Cancelar
              </Button>
            ),
          }
        : {})}
    >
    <form className={estilos['formulario']} action={acao}>
      <input type="hidden" name="tenantId" value={tenantId} />

      <div className={estilos['formulario']}>
        <SelectField
          id="plano-do-contrato"
          name="planId"
          label="Plano"
          required
          value={planoId}
          onChange={(evento) => setPlanoId(evento.target.value)}
          hint="Os valores do plano são copiados para o contrato no fechamento."
          data-testid="campo-plano-do-contrato"
        >
          {planos.map((plano) => (
            <option key={plano.id} value={plano.id}>
              {plano.name} ({plano.model === 'PER_STUDENT' ? 'por aluno' : 'fixo mensal'})
            </option>
          ))}
        </SelectField>

        <div className={estilos['par']}>
          <Field
            id="inicio-do-contrato"
            name="startsAt"
            label="Início da vigência"
            type="date"
            required
            value={inicio}
            onChange={(evento) => setInicio(evento.target.value)}
            data-testid="campo-inicio-do-contrato"
          />

          <Field
            id="dia-de-emissao"
            name="issueDay"
            label="Dia de emissão da fatura"
            type="number"
            min={1}
            max={28}
            required
            /*
              Para em 28 pela mesma razão do vencimento da mensalidade: existir
              em fevereiro sem regra de exceção. O `max` do campo é conveniência
              -- a Server Action e a API validam de novo.
            */
            hint="De 1 a 28."
            defaultValue={estado.valores?.['issueDay'] ?? '1'}
            data-testid="campo-dia-de-emissao"
          />
        </div>

        <Field
          id="carencia-do-contrato"
          name="graceDays"
          label="Carência"
          unit="dias"
          type="number"
          min={0}
          max={180}
          required
          hint="Dias após o vencimento antes de a academia ser suspensa."
          defaultValue={estado.valores?.['graceDays'] ?? '15'}
          data-testid="campo-carencia-do-contrato"
        />

        {fixo ? (
          <>
            <div className={estilos['par']}>
              <Field
                id="indice-do-contrato"
                name="indexCode"
                label="Índice de correção"
                required
                hint="Padrão IPCA. O valor de cada mês entra pelo histórico de índices."
                defaultValue={estado.valores?.['indexCode'] ?? 'IPCA'}
                data-testid="campo-indice-do-contrato"
              />

              <Field
                id="data-base-do-contrato"
                name="baseDate"
                label="Data-base dos valores"
                type="date"
                required
                hint="A partir dela o índice acumula até o aniversário."
                defaultValue={estado.valores?.['baseDate'] ?? ''}
                data-testid="campo-data-base-do-contrato"
              />
            </div>

            <div className={estilos['par']}>
              <Field
                id="dia-do-aniversario"
                name="anniversaryDay"
                label="Dia do aniversário"
                type="number"
                min={1}
                max={31}
                required
                defaultValue={estado.valores?.['anniversaryDay'] ?? '1'}
                data-testid="campo-dia-do-aniversario"
              />

              <Field
                id="mes-do-aniversario"
                name="anniversaryMonth"
                label="Mês do aniversário"
                type="number"
                min={1}
                max={12}
                required
                defaultValue={estado.valores?.['anniversaryMonth'] ?? '1'}
                data-testid="campo-mes-do-aniversario"
              />
            </div>

            <p className={estilos['nota']}>
              Sem o valor do índice cadastrado para algum mês da janela, a correção não roda — e o
              painel diz quais competências faltam.
            </p>
          </>
        ) : (
          <>
            {/*
              CAMPOS ESCONDIDOS, e não ausentes: a API exige data-base, índice e
              aniversário em todo contrato, e o plano por aluno simplesmente não
              os usa. Deixá-los de fora daria erro de validação em cima de um
              formulário que a pessoa preencheu por inteiro.
            */}
            <input type="hidden" name="indexCode" value="IPCA" />
            <input type="hidden" name="baseDate" value={inicio} />
            <input type="hidden" name="anniversaryDay" value="1" />
            <input type="hidden" name="anniversaryMonth" value="1" />

            <p className={estilos['nota']}>
              O plano por aluno não é corrigido por índice: o preço acompanha o catálogo do próximo
              contrato.
            </p>
          </>
        )}

        {/*
          SUPERFÍCIES: o plano traz o padrão, ESTE campo é o que se negocia.

          A `key` é o plano: trocar de plano tem que reposicionar os dois campos
          no padrão do novo. Sem ela, `defaultValue` ficaria preso ao plano que
          estava escolhido na montagem -- e o contrato sairia com a superfície
          do plano errado.
        */}
        <div className={estilos['par']} key={escolhido?.id ?? 'sem-plano'}>
          <SelectField
            id="mobile-do-contrato"
            name="mobileEnabled"
            label="App mobile do aluno"
            required
            hint="O app do aluno chega no MVP 4; o contrato já registra se está incluído."
            defaultValue={
              estado.valores?.['mobileEnabled'] ?? (escolhido?.mobileEnabled === false ? 'nao' : 'sim')
            }
            data-testid="campo-mobile-do-contrato"
          >
            <option value="sim">Incluído</option>
            <option value="nao">Não incluído</option>
          </SelectField>

          <SelectField
            id="totem-do-contrato"
            name="kioskEnabled"
            label="Totem de autoatendimento"
            required
            hint="Não incluído: o totem desta academia para de autenticar assim que o contrato fecha."
            defaultValue={
              estado.valores?.['kioskEnabled'] ?? (escolhido?.kioskEnabled === false ? 'nao' : 'sim')
            }
            data-testid="campo-totem-do-contrato"
          >
            <option value="sim">Incluído</option>
            <option value="nao">Não incluído</option>
          </SelectField>
        </div>

        {estado.salvo ? (
          <p className={proprios['salvo']} role="status" data-testid="contrato-aberto">
            Contrato aberto em rascunho. Confira os dados na tabela acima e feche o contrato para
            gerar o PDF.
          </p>
        ) : null}

        <div className={estilos['acoes']}>
          <BotaoDeAbrir />
        </div>
      </div>
    </form>
    </SectionCard>
  );
}
