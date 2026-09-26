'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, TenantDateTime, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../../formulario.module.css';

import {
  cadastrarEdgeNode,
  gerarCodigoDePareamento,
  type EstadoDoEdgeNode,
  type EstadoDoPareamento,
} from '../../../../actions/edge-nodes';

interface Unidade {
  id: string;
  name: string;
  timezone: string;
}

interface Props {
  readonly unidades: readonly Unidade[];
}

const ESTADO_INICIAL: EstadoDoEdgeNode = {};
const ESTADO_INICIAL_DO_PAREAMENTO: EstadoDoPareamento = {};

function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-edge-node">
      {pending ? 'Cadastrando…' : 'Cadastrar Edge'}
    </Button>
  );
}

function BotaoDePareamento() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="gerar-pareamento">
      {pending ? 'Gerando…' : 'Gerar código de pareamento'}
    </Button>
  );
}

/**
 * Cadastro de Edge e pareamento, na mesma tela (issue #404).
 *
 * As duas etapas ficam juntas porque são um ato só na instalação: quem
 * cadastra o Edge está com o PC da recepção na frente e precisa do código
 * agora. Separar em duas telas obrigaria a voltar para buscar o que só
 * aparece uma vez.
 */
export function FormularioDeEdgeNode({ unidades }: Props) {
  const [estado, acao] = useActionState(cadastrarEdgeNode, ESTADO_INICIAL);
  const [pareamento, acaoDePareamento] = useActionState(
    gerarCodigoDePareamento,
    ESTADO_INICIAL_DO_PAREAMENTO,
  );

  /*
   * NÃO semeia de `estado.valores`: o componente não remonta entre a falha e
   * a nova tentativa, então o inicializador só correria uma vez e daria a
   * impressão de preservar o que o próprio select controlado já preserva.
   */
  const [unidadeEscolhida, setUnidadeEscolhida] = useState(unidades[0]?.id ?? '');

  /*
   * O fuso sai da unidade que o SERVIDOR confirmou, e só cai na escolha do
   * formulário enquanto não há Edge criado. `TenantDateTime` exige
   * `timeZone` sem default e o fuso do navegador não serve (DS §11, regra 5)
   * -- ler o do formulário depois do sucesso arriscaria datar a validade no
   * fuso de outra unidade.
   */
  const unidadeDoFuso = estado.sucesso?.gymUnitId ?? unidadeEscolhida;

  const fusoDaUnidade = unidades.find((unidade) => unidade.id === unidadeDoFuso)?.timezone;

  useToastDeErro(estado.erro, 'error', 'erro-do-edge-node');
  useToastDeErro(pareamento.erro, 'error', 'erro-do-pareamento');

  if (unidades.length === 0) {
    return (
      <p data-testid="sem-unidades">
        Nenhuma unidade cadastrada. <a href="/units/nova">Cadastre uma unidade</a> antes de
        instalar um Edge — todo agente atende uma unidade.
      </p>
    );
  }

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="edge-node-cadastrado">
        <p>
          Edge <strong>{estado.sucesso.code}</strong> cadastrado.
        </p>

        {pareamento.sucesso ? (
          <div data-testid="codigo-de-pareamento">
            <p>
              Código de pareamento: <strong>{pareamento.sucesso.code}</strong>
            </p>
            <p role="note" className={estilos['nota']}>
              Ele aparece <strong>uma única vez</strong>
              {fusoDaUnidade === undefined ? null : (
                <>
                  {' '}
                  e vale até{' '}
                  <TenantDateTime iso={pareamento.sucesso.expiresAt} timeZone={fusoDaUnidade} />
                </>
              )}
              . Copie agora para o <code>.env</code> do PC da recepção, em{' '}
              <code>EDGE_PAIRING_CODE</code>. Se fechar sem copiar, gere outro — este morre no
              primeiro uso.
            </p>
          </div>
        ) : (
          <form action={acaoDePareamento}>
            <input type="hidden" name="edgeNodeId" value={estado.sucesso.id} />
            <BotaoDePareamento />
          </form>
        )}

        <p>
          <a href="/operations">Voltar para Operação</a>
        </p>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>
      <SelectField
        id="unidade-do-edge-node"
        name="gymUnitId"
        label="Unidade"
        value={unidadeEscolhida}
        onChange={(evento) => setUnidadeEscolhida(evento.target.value)}
        required
        data-testid="campo-unidade-do-edge-node"
      >
        {unidades.map((unidade) => (
          <option key={unidade.id} value={unidade.id}>
            {unidade.name}
          </option>
        ))}
      </SelectField>

      <Field
        id="codigo-do-edge-node"
        name="code"
        label="Código do Edge"
        defaultValue={estado.valores?.['code'] ?? ''}
        maxLength={80}
        required
        hint="Identificador estável, escolhido na instalação. Ex.: RECEPCAO-01."
        data-testid="campo-codigo-do-edge-node"
      />

      <p role="note" className={estilos['nota']}>
        O Edge é o agente que roda no PC da recepção e decide a liberação da catraca. Depois de
        cadastrar, gere o código de pareamento aqui mesmo — é ele que dá identidade ao agente na
        primeira execução.
      </p>

      <div className={estilos['acoes']}>
        <BotaoDeCadastro />
        <Button href="/operations" variant="ghost">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
