import { StyleSheet, Text, View } from 'react-native';

import { Botao } from '../../ui/Botao.js';
import { Card } from '../../ui/Card.js';
import { useTema } from '../../ui/theme.js';

export interface InvoiceDoApp {
  readonly invoiceId: string;
  readonly status: string;
  readonly vencimentoEm: string;
  readonly pagoEm: string | null;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}

export interface DadosDoFinanceiro {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly invoices: readonly InvoiceDoApp[];
}

/**
 * Faturas do aluno so podem ser pagas nestes status -- espelha
 * `podeTransicionar` do `criar-cobranca-pix.use-case.ts`. NAO decide se o
 * pagamento e aceito (`M4-BR-008`: o app nao recalcula estado financeiro);
 * so decide se mostra o botao. O backend recusa de qualquer forma se este
 * espelho ficar desatualizado.
 */
const STATUS_PAGAVEL = new Set(['OPEN', 'OVERDUE']);

/** `15000` (centavos, BRL) -> `R$ 150,00`. */
function formatarValor(valorEmCentavos: number, moeda: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(
    valorEmCentavos / 100,
  );
}

/** `2026-09-20T00:00:00.000Z` -> `20/09/2026`, sempre em UTC. */
function formatarData(iso: string): string {
  const data = new Date(iso);
  const dia = data.getUTCDate().toString().padStart(2, '0');
  const mes = (data.getUTCMonth() + 1).toString().padStart(2, '0');

  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

/**
 * Financeiro do aluno -- Slice 4.3, `M4-FR-009`.
 *
 * SEM PARAMETRO DE ALUNO E SEM CALCULO DE ESTADO: a lista e o `status` de
 * cada invoice vem prontos do backend, mesma regra de `plano.tsx`
 * (`M4-BR-008`). A tela so decide se MOSTRA o botao "Pagar" -- nunca se o
 * pagamento e aceito.
 */
export function Financeiro({
  dados,
  onPagar,
  testID,
}: {
  dados: DadosDoFinanceiro;
  onPagar: (invoiceId: string) => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  const corpo = {
    color: t.cor.text.secondary,
    fontSize: t.type.body.size,
    lineHeight: t.type.body.lineHeight,
  };

  if (dados.status === 'UNAVAILABLE') {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Card titulo="Sem conexão com a academia">
          <Text style={corpo}>
            Não foi possível atualizar agora. Suas faturas aparecem assim que a
            conexão voltar.
          </Text>
        </Card>
      </View>
    );
  }

  if (dados.invoices.length === 0) {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Card titulo="Financeiro">
          <Text testID="financeiro-vazio" style={corpo}>
            Você não tem faturas no momento.
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View testID={testID} style={estilos.bloco}>
      {dados.invoices.map((invoice) => (
        <Card key={invoice.invoiceId} titulo={formatarValor(invoice.valorEmCentavos, invoice.moeda)}>
          <View style={estilos.linha}>
            <Text style={corpo}>Vencimento</Text>
            <Text style={corpo}>{formatarData(invoice.vencimentoEm)}</Text>
          </View>

          {STATUS_PAGAVEL.has(invoice.status) ? (
            <Botao
              titulo="Pagar"
              variante="primario"
              emCard
              testID={`financeiro-pagar-${invoice.invoiceId}`}
              onPress={() => onPagar(invoice.invoiceId)}
            />
          ) : null}
        </Card>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
