'use client';

import { useActionState, useState, useTransition } from 'react';

import { Field, useToastDeErro } from '@arenahub/ui';

import {
  salvarConfiguracaoDeEngajamento,
  type ConfiguracaoDeEngajamento,
  type EstadoDaConfiguracao,
} from '../../../actions/engagement';
import estilos from './configuracao.module.css';

const ESTADO_INICIAL: EstadoDaConfiguracao = {};

/** As três capacidades, com o que desligar cada uma faz de verdade. */
const CAPACIDADES = [
  {
    campo: 'rankingEnabled',
    rotulo: 'Placar e pontos',
    efeito: 'Desligado, o bloco do placar sai da tela pública e a área de pontos some do totem.',
  },
  {
    campo: 'challengesEnabled',
    rotulo: 'Desafios',
    efeito: 'Desligado, nenhum desafio novo abre e os abertos param de aparecer para o aluno.',
  },
  {
    campo: 'achievementsEnabled',
    rotulo: 'Conquistas',
    efeito: 'Desligado, para de avaliar e de exibir conquistas novas.',
  },
] as const;

/**
 * Configuração do engajamento -- F35, Slice 5.6, ADR-049 Decisão 3.
 *
 * Desligar NÃO apaga nada: o histórico de pontos continua, o placar publicado
 * continua, o aluno só para de ver. Religar devolve tudo. A tela diz isso em
 * texto porque quem desliga precisa saber que é reversível antes de clicar.
 */
export function PainelDeConfiguracao({
  inicial,
}: {
  readonly inicial: ConfiguracaoDeEngajamento;
}) {
  const [estado, acao] = useActionState(salvarConfiguracaoDeEngajamento, ESTADO_INICIAL);
  const [config, setConfig] = useState(inicial);
  const [enviando, iniciarEnvio] = useTransition();

  useToastDeErro(estado.erro, 'error', 'erro-da-configuracao');

  function alternar(campo: (typeof CAPACIDADES)[number]['campo'], ligado: boolean) {
    setConfig((atual) => ({ ...atual, [campo]: ligado }));

    const formulario = new FormData();
    formulario.set(campo, String(ligado));

    iniciarEnvio(() => {
      acao(formulario);
    });
  }

  function salvarTeto(valor: string) {
    const formulario = new FormData();
    // Campo vazio é "sem teto" (null), e é diferente de zero, que é "ninguém
    // corrige". A action distingue os dois — a tela não pode colapsá-los.
    formulario.set('correctionLimitPoints', valor);

    iniciarEnvio(() => {
      acao(formulario);
    });
  }

  return (
    <div className={estilos['painel']} data-testid="painel-de-configuracao">
      <fieldset className={estilos['grupo']}>
        <legend>O que o aluno vê</legend>

        {CAPACIDADES.map((capacidade) => (
          <div key={capacidade.campo} className={estilos['capacidade']}>
            <input
              id={`flag-${capacidade.campo}`}
              type="checkbox"
              checked={config[capacidade.campo]}
              disabled={enviando}
              onChange={(evento) => alternar(capacidade.campo, evento.target.checked)}
              aria-describedby={`efeito-${capacidade.campo}`}
              data-testid={`flag-${capacidade.campo}`}
            />
            <span>
              {/* `htmlFor` explicito: o rotulo e o nome da capacidade, e o
                  efeito vai em `aria-describedby` -- quem usa leitor de tela
                  ouve "Desafios, caixa de selecao" e so depois a consequencia,
                  em vez das duas frases coladas como se fossem o nome. */}
              <label htmlFor={`flag-${capacidade.campo}`}>
                <strong>{capacidade.rotulo}</strong>
              </label>
              <span id={`efeito-${capacidade.campo}`} className={estilos['efeito']}>
                {capacidade.efeito}
              </span>
            </span>
          </div>
        ))}

        <p className={estilos['aviso']}>
          Desligar não apaga nada: os pontos, o placar publicado e os desafios continuam
          guardados. Religar traz tudo de volta.
        </p>
      </fieldset>

      <fieldset className={estilos['grupo']}>
        <legend>Limite da correção de pontos</legend>

        <Field
          id="teto-de-correcao"
          name="correctionLimitPoints"
          label="Máximo por correção"
          type="number"
          defaultValue={config.correctionLimitPoints ?? ''}
          disabled={enviando}
          onBlur={(evento) => salvarTeto(evento.target.value)}
          data-testid="teto-de-correcao"
        />

        <p className={estilos['aviso']}>
          Vale para dar e para tirar: um limite de 100 recusa tanto +150 quanto −150. Uma correção
          acima do limite é recusada na hora — não fica esperando aprovação de ninguém. Deixe vazio
          para não ter limite.
        </p>
      </fieldset>

      {estado.sucesso && (
        <p className={estilos['salvo']} data-testid="configuracao-salva">
          Alterações salvas.
        </p>
      )}

      {/*
        SEM BOTAO DE DESFAZER: cada alteracao ja foi gravada quando o operador
        clicou. Um "desfazer" que so mexesse no estado da tela mentiria sobre
        o que esta no servidor -- para reverter, basta clicar de novo.
      */}
    </div>
  );
}
