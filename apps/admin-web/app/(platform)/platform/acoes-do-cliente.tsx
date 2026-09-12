'use client';

import { useState } from 'react';

import { AcoesDaLinha, Button, ConfirmDialog, Icon, RowMenu, useToastDeErro } from '@arenahub/ui';

import { alternarStatusDoTenant, type EstadoDoStatus } from '../../actions/platform';
import estilos from './clientes.module.css';

interface Props {
  readonly tenantId: string;
  readonly displayName: string;
  readonly status: string;
}

/**
 * As quatro acoes de um cliente, na propria linha da lista — F68.
 *
 * ANTES ELAS MORAVAM NA TELA DE DETALHE, e chegar a qualquer uma custava abrir
 * o cliente e rolar: "Contratos" e "Faturas" no topo, "Inativar" a um scroll
 * de distancia, no fim de um formulario de quatro blocos. Pedido do PI para
 * trazer as tres para a grid; "Editar" entrou junto porque abrir o cadastro e
 * a quarta coisa que se faz com um cliente, e deixa-la de fora obrigaria a
 * clicar no nome para uma acao e no menu para as outras tres.
 *
 * EM 11/09/2026 AS TRES NAVEGACOES SAIRAM DO MENU, a pedido do PI: atras de um
 * alvo de tres pontos, cada uma custava dois cliques e o alvo nao diz o que
 * faz. "Editar" ficou com rotulo por ser a mais frequente; "Contratos" e
 * "Faturas" viraram icone porque a celula tem 133px e a tabela ja ocupa a
 * largura inteira do container -- tres rotulos comeriam a coluna do nome.
 *
 * No menu sobrou SO a mudanca de situacao, que e a unica que altera o mundo.
 *
 * INATIVAR CONFIRMA COM MOTIVO, e a confirmacao e o `SensitiveAction` que o
 * produto ja usa em revogacao de biometria e estorno: desligar um cliente
 * corta a catraca dele e para a cobranca. Um item de menu que executasse
 * direto seria um acidente a um clique de distancia — e o motivo vai para a
 * auditoria da plataforma, que e onde alguem pergunta por que o cliente parou.
 *
 * REATIVAR NAO PEDE CONFIRMACAO com o mesmo peso, mas pede o motivo pela mesma
 * razao: a API exige, e a auditoria registra os dois sentidos.
 */
export function AcoesDoCliente({ tenantId, displayName, status }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoDoStatus>({});

  useToastDeErro(estado.erro, 'error', 'erro-da-situacao');

  const inativando = status === 'ACTIVE';

  /*
   * SUSPENSO NAO OFERECE O ATO: quem escreve `SUSPENDED` e a inadimplencia
   * (F65), e reativar por aqui esconderia a divida em vez de resolve-la. A
   * acao simplesmente nao aparece — item desabilitado convida ao clique e nao
   * explica nada.
   */
  const suspenso = status === 'SUSPENDED';

  const aplicar = (motivo: string): void => {
    const dados = new FormData();

    dados.set('tenantId', tenantId);
    dados.set('status', inativando ? 'INACTIVE' : 'ACTIVE');
    dados.set('reason', motivo);

    setConfirmando(false);

    /*
      A Server Action e chamada direto em vez de por `useActionState`: o menu
      nao e um `<form>`, e embrulhar quatro itens num formulario so para um
      deles poder enviar criaria um envio por engano nos outros tres.
    */
    void alternarStatusDoTenant({}, dados).then(setEstado);
  };

  return (
    <>
      <AcoesDaLinha>
        {/*
          "EDITAR" PROMOVIDO A BOTAO VISIVEL -- pedido do PI em 11/09/2026.

          E a acao mais frequente da linha e a unica que serve a qualquer
          situacao do cliente: com as quatro atras dos tres pontos, abrir um
          cadastro custava dois cliques e um alvo que nao diz o que faz.

          As OUTRAS TRES continuam no menu, e nao promovidas junto: quatro
          botoes por linha dariam a coluna de acao mais largura que a do nome
          do cliente, e a lista existe para comparar clientes, nao para operar
          um de cada vez.
        */}
        {/*
          `outline` e nao uma variante nova de linha: o `DataTable` ja
          normaliza o botao da celula de acao (altura automatica com piso de
          36px e teto de 24ch), e uma altura propria aqui perderia para aquela
          regra -- mais especifica -- sem que nada acusasse.
        */}
        <Button variant="outline" href={`/platform/${tenantId}`} data-testid="editar-cliente">
          Editar
        </Button>

        {/*
          CONTRATOS E FATURAS COMO ICONE, e nao como botao de texto: medido na
          tela, a celula de acao tem 133px e a tabela ja ocupa os 959px do
          container inteiro -- tres rotulos lado a lado empurrariam a coluna
          para cima do nome do cliente, que e o que a lista existe para
          comparar.

          `variant="icon"` e a forma que o design system ja define para acao de
          LINHA (32px, contra os 36px do controle). O `aria-label` e exigido
          pelo tipo do componente, entao quem usa leitor de tela ouve "Contratos
          de Academia Auth", nao "link".
        */}
        <Button
          variant="icon"
          href={`/platform/${tenantId}/contratos`}
          aria-label={`Contratos de ${displayName}`}
          title="Contratos"
          data-testid="contratos-do-cliente"
        >
          <Icon name="file-text" />
        </Button>

        <Button
          variant="icon"
          href={`/platform/${tenantId}/faturas`}
          aria-label={`Faturas de ${displayName}`}
          title="Faturas"
          data-testid="faturas-do-cliente"
        >
          <Icon name="receipt" />
        </Button>

        {/*
          A SITUACAO CONTINUA NO MENU, sozinha: ela e a unica acao destrutiva
          da linha, e um alvo de 32px ao lado de dois iguais convidaria ao
          clique errado. Suspenso nao oferece ato nenhum -- e ai o menu some
          inteiro em vez de abrir vazio.
        */}
        {suspenso ? (
          /*
            O ESPACO DO MENU FICA RESERVADO quando ele nao existe -- visto na
            tela em 11/09/2026.

            `AcoesDaLinha` e `inline-flex` encostado a direita: sem o menu, a
            linha suspensa encolhia 32px e TODOS os alvos dela escorregavam
            para a direita, saindo do eixo das demais. Numa lista de 89
            clientes com 6 suspensos, isso e uma coluna de "Editar" que
            serrilha em seis pontos.

            Um `<span>` vazio do tamanho do alvo, e nao um botao desabilitado:
            botao cinza convida ao clique e nao explica nada -- a razao de o
            ato nao aparecer continua sendo a do comentario acima.

            `aria-hidden` porque nao ha nada a anunciar: quem usa leitor de
            tela ouve as tres acoes que existem, sem um quarto item mudo.
          */
          <span className={estilos['vaoDoMenu']} aria-hidden="true" />
        ) : (
          <RowMenu
            label={`Mais ações de ${displayName}`}
            testId="acoes-do-cliente"
            itens={[
              {
                id: 'situacao',
                label: inativando ? 'Inativar cliente' : 'Reativar cliente',
                icon: 'power' as const,
                onSelect: () => setConfirmando(true),
                perigo: inativando,
              },
            ]}
          />
        )}
      </AcoesDaLinha>

      <ConfirmDialog
        open={confirmando}
        verb={inativando ? 'Inativar cliente' : 'Reativar cliente'}
        summary={
          inativando
            ? `${displayName} deixa de liberar a catraca e de ser cobrada. Os dados permanecem, e a reativação devolve tudo.`
            : `${displayName} volta à operação normal: catraca liberada e cobrança retomada.`
        }
        onConfirm={aplicar}
        onCancel={() => setConfirmando(false)}
        testId="confirmar-situacao-do-cliente"
      />
    </>
  );
}
