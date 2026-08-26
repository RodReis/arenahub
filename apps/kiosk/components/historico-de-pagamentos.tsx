'use client';

import { useEffect, useState } from 'react';

import { formatarDinheiro } from '../lib/dinheiro';
import {
  carregarPagamentos,
  type LinhaDePagamento,
  type SessaoDoAluno,
} from '../lib/kiosk-client';
import { mesDaMedicao } from '../lib/saude';

/** Como cada estado de fatura se chama para o aluno. */
const ROTULO_DE_STATUS: Record<string, string> = {
  OPEN: 'Em aberto',
  OVERDUE: 'Vencida',
  PAID: 'Paga',
  CANCELLED: 'Cancelada',
  REFUNDED: 'Estornada',
  DRAFT: 'Em preparo',
};

/**
 * Histórico de pagamentos -- `DS-TOTEM.md` §5.7.
 *
 * A FATURA EM ABERTO VEM NO TOPO, sempre -- inclusive vencida ha muito
 * tempo. O recorte de meses corta o que ja foi resolvido; a divida em
 * aberto escapa dele, porque some-la da tela faria o totem afirmar por
 * omissao que nao ha o que pagar (a regra vive em
 * `recortarHistorico`, no servidor).
 *
 * AQUI O VALOR APARECE, e e correto: chegar nesta tela ja e acao
 * deliberada do aluno, dois toques depois da identificacao
 * (`DS-TOTEM.md` §9.1).
 */
export function HistoricoDePagamentos({
  sessao,
  aoPagar,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoPagar: (() => void) | undefined;
  readonly aoVoltar: () => void;
}) {
  const [linhas, setLinhas] = useState<readonly LinhaDePagamento[] | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;

    void carregarPagamentos(sessao.sessionId, sessao.token).then((dados) => {
      if (vivo) setLinhas(dados);
    });

    return () => {
      vivo = false;
    };
  }, [sessao.sessionId, sessao.token]);

  const emAberto = linhas?.find((l) => l.emAberto) ?? null;

  return (
    <div className="telaInterna">
      <h1 className="tituloDeTela">Meus pagamentos</h1>

      {linhas === undefined && <p className="corpo">Carregando…</p>}

      {linhas === null && (
        <p className="corpo" data-testid="pagamentos-falhou">
          Não foi possível carregar agora. Procure a recepção.
        </p>
      )}

      {linhas !== null && linhas !== undefined && linhas.length === 0 && (
        <p className="corpo" data-testid="sem-pagamentos">
          Você ainda não tem faturas registradas.
        </p>
      )}

      {linhas !== null && linhas !== undefined && linhas.length > 0 && (
        <div className="listaDePagamentos" data-testid="lista-de-pagamentos">
          {linhas.map((linha) => (
            <div
              key={linha.invoiceId}
              className={linha.emAberto ? 'pagamentoEmAberto' : 'pagamento'}
              data-testid={`pagamento-${linha.invoiceId}`}
            >
              <span className="corpo">{mesDaMedicao(linha.vencimentoEm) ?? '—'}</span>

              <span className="valorDoPagamento">
                {formatarDinheiro(linha.valorEmCentavos, linha.moeda)}
              </span>

              {/*
                Estado NUNCA so por cor -- o rotulo textual acompanha
                sempre (checklist §8, acessibilidade).
              */}
              <span className="metadado" data-testid={`status-${linha.invoiceId}`}>
                {ROTULO_DE_STATUS[linha.status] ?? linha.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/*
        O CTA de pagar so existe quando ha fatura em aberto E o modulo de
        pagamento esta ligado -- `aoPagar` chega indefinido quando nao esta,
        e a tela nao oferece um caminho que o servidor recusaria com 404.
      */}
      {emAberto !== null && aoPagar !== undefined && (
        <button type="button" className="ctaPrimario" data-testid="pagar-em-aberto" onClick={aoPagar}>
          Pagar fatura em aberto · {formatarDinheiro(emAberto.valorEmCentavos, emAberto.moeda)}
        </button>
      )}

      <button type="button" className="botaoSecundario" onClick={aoVoltar}>
        Voltar
      </button>
    </div>
  );
}
