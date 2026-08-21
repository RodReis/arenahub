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
}

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

export function PainelDeAnalise({ analise, timeZone }: Props) {
  return (
    <aside className={estilos['painel']} aria-labelledby="titulo-painel-analise">
      <h2 id="titulo-painel-analise">Análise de acompanhamento</h2>

      <p className={estilos['avisoDeIa']} role="note" data-testid="aviso-de-ia">
        Esta análise organiza os dados dos três laudos para conversa com o profissional. Não é
        diagnóstico e não substitui avaliação médica.
      </p>

      {analise === null ? (
        <p data-testid="analise-ausente">Nenhuma análise publicada para este aluno ainda.</p>
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
