'use client';

import { useState } from 'react';

import {
  abrirContestacao,
  type AssuntoDaContestacao,
  type SessaoDoAluno,
} from '../lib/kiosk-client';

/**
 * Contestar o que a tela mostrou -- F35, Slice 5.6, `M5-FR-016`.
 *
 * VIVE DENTRO DA TELA QUE MOSTRA O NUMERO, nao numa area separada: o aluno
 * contesta olhando para o que discorda. Uma tela propria de "minhas
 * contestacoes" obrigaria a lembrar o que viu e sair para procurar.
 *
 * O totem e uma tela de recepcao, tocada em pe: o campo tem limite curto e a
 * mensagem de erro diz o que fazer, nao o que falhou. Nao ha upload, nem
 * anexo, nem escolha de quem vai resolver.
 */

const MINIMO = 5;
const MAXIMO = 500;

/** O que o aluno pode contestar, no vocabulario dele -- nao no do banco. */
const ASSUNTOS: readonly { readonly valor: AssuntoDaContestacao; readonly rotulo: string }[] = [
  { valor: 'XP', rotulo: 'Meus pontos' },
  { valor: 'CONSISTENCIA', rotulo: 'Minhas semanas na meta' },
  { valor: 'CONQUISTA', rotulo: 'Uma conquista' },
  { valor: 'RANKING', rotulo: 'Minha posição no placar' },
  { valor: 'DESAFIO', rotulo: 'Um desafio' },
];

type Estado =
  | { fase: 'fechado' }
  | { fase: 'escrevendo' }
  | { fase: 'enviando' }
  | { fase: 'enviado' }
  | { fase: 'falhou' };

export function Contestacao({
  sessao,
  assuntoInicial = 'XP',
}: {
  readonly sessao: SessaoDoAluno;
  readonly assuntoInicial?: AssuntoDaContestacao;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'fechado' });
  const [assunto, setAssunto] = useState<AssuntoDaContestacao>(assuntoInicial);
  const [descricao, setDescricao] = useState('');

  const texto = descricao.trim();
  const podeEnviar = texto.length >= MINIMO && texto.length <= MAXIMO;

  async function enviar() {
    if (!podeEnviar) return;

    setEstado({ fase: 'enviando' });

    const criada = await abrirContestacao(sessao.sessionId, sessao.token, assunto, texto);

    // `null` cobre rede caida E recusa do servidor. Os dois pedem a mesma
    // coisa do aluno: tentar de novo ou procurar a recepcao -- distinguir
    // aqui so daria a ele um detalhe que nao muda o que ele faz.
    setEstado(criada === null ? { fase: 'falhou' } : { fase: 'enviado' });
    if (criada !== null) setDescricao('');
  }

  if (estado.fase === 'enviado') {
    return (
      <div className="cardDeMetrica" data-testid="contestacao-enviada">
        <span className="metadado">Recebemos sua mensagem</span>
        <p className="corpo">
          A recepção vai analisar e responder. Você não precisa fazer mais nada.
        </p>
      </div>
    );
  }

  if (estado.fase === 'fechado') {
    return (
      <button
        type="button"
        className="botaoSecundario"
        onClick={() => setEstado({ fase: 'escrevendo' })}
        data-testid="abrir-contestacao"
      >
        Algum número está errado?
      </button>
    );
  }

  const enviando = estado.fase === 'enviando';

  return (
    <div className="cardDeMetrica" data-testid="formulario-de-contestacao">
      <label className="metadado" htmlFor="assunto-da-contestacao">
        Sobre o que é
      </label>
      <select
        id="assunto-da-contestacao"
        value={assunto}
        disabled={enviando}
        onChange={(evento) => setAssunto(evento.target.value as AssuntoDaContestacao)}
        data-testid="assunto-da-contestacao"
      >
        {ASSUNTOS.map((opcao) => (
          <option key={opcao.valor} value={opcao.valor}>
            {opcao.rotulo}
          </option>
        ))}
      </select>

      <label className="metadado" htmlFor="descricao-da-contestacao">
        O que aconteceu
      </label>
      <textarea
        id="descricao-da-contestacao"
        value={descricao}
        maxLength={MAXIMO}
        rows={3}
        disabled={enviando}
        onChange={(evento) => setDescricao(evento.target.value)}
        data-testid="descricao-da-contestacao"
      />

      {estado.fase === 'falhou' && (
        <p className="corpo" data-testid="contestacao-falhou">
          Não foi possível enviar agora. Tente de novo ou procure a recepção.
        </p>
      )}

      <button
        type="button"
        className="ctaPrimario"
        disabled={!podeEnviar || enviando}
        onClick={() => void enviar()}
        data-testid="enviar-contestacao"
      >
        {enviando ? 'Enviando…' : 'Enviar'}
      </button>

      <button
        type="button"
        className="botaoSecundario"
        disabled={enviando}
        onClick={() => {
          setEstado({ fase: 'fechado' });
          setDescricao('');
        }}
      >
        Voltar
      </button>
    </div>
  );
}
