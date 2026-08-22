import { TenantDateTime } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * Painel "Análise de acompanhamento" -- mock do PI + `DS-PAINEL.md` §8.4.
 *
 * O aviso é PERSISTENTE e NÃO dispensável (regra de arquitetura 8): nenhum
 * botão de fechar, nenhum estado que o esconda depois da primeira leitura.
 *
 * `modelVersion`/`promptVersion`/janela do snapshot NÃO aparecem aqui:
 * `GET /students/:id/ai-analyses/latest` não devolve esses campos (só
 * `id`, `generatedAt` e a saída validada) -- `promptVersionId` existe no
 * repositório, mas o controller não o expõe. Inventar aqui violaria a regra
 * de não fabricar dado; o rodapé mostra só o que a API garante: o instante
 * de geração.
 */

export interface AnaliseDeAcompanhamento {
  readonly summary: string;
  readonly positivePoints: readonly string[];
  readonly attentionPoints: readonly string[];
  readonly questionsForProfessional: readonly string[];
  readonly generatedAt: string;
}

interface Props {
  readonly analise: AnaliseDeAcompanhamento | null;
  readonly timeZone: string;
  /**
   * Por que não há análise, quando não há.
   *
   * `null` significa "há análise, ou o motivo não pôde ser consultado".
   * Sem isto o painel dizia só "Nenhuma análise publicada", que trata três
   * situações diferentes como uma: o aluno ainda não tem avaliação, o aluno
   * nunca consentiu, e o aluno recusou. Só a primeira passa sozinha — as
   * outras duas esperam ação de quem opera, e o silêncio fazia a recepção
   * aguardar por algo que nunca chegaria.
   */
  readonly motivoDaAusencia?: string | null;
}

const SEM_ANALISE = 'Nenhuma análise publicada para este aluno ainda.';

/**
 * O motivo em linguagem de quem opera, com a AÇÃO junto.
 *
 * Regra do `PRODUCT.md`: erro sempre traz ação possível, nunca detalhe
 * técnico. `AI_CONSENT_MISSING_STUDENT` não diz nada a quem está no balcão;
 * "o aluno precisa aceitar" diz.
 */
const MOTIVO_LEGIVEL: Record<string, string> = {
  AI_CONSENT_MISSING_STUDENT:
    'A análise não foi gerada: o aluno ainda não aceitou o envio dos dados de saúde para análise. O aceite é registrado na ficha do aluno.',
  AI_CONSENT_REFUSED_STUDENT:
    'A análise não foi gerada: o aluno recusou o envio dos dados de saúde para análise. A avaliação continua publicada e visível para ele.',
};

function ListaOuVazia({ titulo, itens }: { titulo: string; itens: readonly string[] }) {
  if (itens.length === 0) return null;

  return (
    <div className={estilos['blocoDaAnalise']}>
      <p className={estilos['rotuloDaAnalise']}>{titulo}</p>
      <ul>
        {itens.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PainelDeAnalise({ analise, timeZone, motivoDaAusencia }: Props) {
  return (
    <aside className={estilos['painel']} aria-labelledby="titulo-painel-analise">
      <h2 id="titulo-painel-analise">Análise de acompanhamento</h2>

      <p className={estilos['avisoDeIa']} role="note" data-testid="aviso-de-ia">
        Esta análise organiza os dados dos três laudos para conversa com o profissional. Não é
        diagnóstico e não substitui avaliação médica.
      </p>

      {analise === null ? (
        <p data-testid="analise-ausente">{MOTIVO_LEGIVEL[motivoDaAusencia ?? ''] ?? SEM_ANALISE}</p>
      ) : (
        <>
          <div className={estilos['blocoDaAnalise']}>
            <p className={estilos['rotuloDaAnalise']}>Resumo</p>
            <p data-testid="resumo-da-analise">{analise.summary}</p>
          </div>

          <ListaOuVazia titulo="Pontos positivos" itens={analise.positivePoints} />
          <ListaOuVazia titulo="Pontos de atenção" itens={analise.attentionPoints} />
          <ListaOuVazia
            titulo="Perguntas para o profissional"
            itens={analise.questionsForProfessional}
          />

          <p className={estilos['rodapeDaAnalise']}>
            Gerada em <TenantDateTime iso={analise.generatedAt} timeZone={timeZone} format="datetime" />
          </p>
        </>
      )}
    </aside>
  );
}
