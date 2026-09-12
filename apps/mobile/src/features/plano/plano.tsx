import { StyleSheet, Text, View } from 'react-native';

import { Ausente } from '../../ui/Ausente.js';
import { Badge } from '../../ui/Badge.js';
import { Card } from '../../ui/Card.js';
import { ICONE_DO_TOM } from '../../ui/icones.js';
import { useTema, type Tom } from '../../ui/theme.js';

export type SituacaoDoPlano = 'SCHEDULED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface DadosDoPlano {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly plano: {
    readonly situacao: SituacaoDoPlano;
    readonly inicioEm: string;
    readonly fimEm: string;
    readonly nome: string | null;
  } | null;
}

/**
 * A traducao de cada situacao, num lugar so.
 *
 * O BACKEND MANDA O ENUM E A TELA TRADUZ -- nunca o contrario. Traduzir no
 * servidor poria texto de interface em dois lugares (API e app), e o primeiro
 * a mudar passaria a mentir.
 *
 * O TOM acompanha a situacao e nunca e o unico canal: o `Badge` exige icone
 * (DS-APP §7), entao quem nao separa verde de laranja le o glifo e o texto.
 */
const APARENCIA: Record<SituacaoDoPlano, { texto: string; tom: Tom }> = {
  ACTIVE: { texto: 'Ativo', tom: 'ok' },
  SCHEDULED: { texto: 'Agendado', tom: 'info' },
  SUSPENDED: { texto: 'Suspenso', tom: 'warn' },
  REVOKED: { texto: 'Cancelado', tom: 'err' },
  EXPIRED: { texto: 'Vencido', tom: 'err' },
};

/** `2026-10-01T00:00:00.000Z` -> `01/10/2026`, sempre em UTC. */
function formatarData(iso: string): string {
  const data = new Date(iso);
  const dia = data.getUTCDate().toString().padStart(2, '0');
  const mes = (data.getUTCMonth() + 1).toString().padStart(2, '0');

  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

/**
 * Plano do aluno -- Slice 4.2, `M4-FR-006`.
 *
 * ESTA TELA NAO DERIVA ESTADO. Nao ha `if (fimEm < hoje)` aqui, e a ausencia
 * e o desenho: `M4-FR-006` manda "exibir status da assinatura SEM INFERIR
 * ESTADO NO CLIENTE". Um direito `ACTIVE` com `fimEm` no passado existe de
 * verdade -- enquanto o job de expiracao nao rodou --, e a tela que
 * "corrigisse" isso sozinha criaria uma segunda autoridade sobre acesso,
 * baseada no relogio do celular, que erra.
 */
export function Plano({ dados, testID }: { dados: DadosDoPlano; testID?: string | undefined }) {
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
            Não foi possível atualizar agora. Seu plano aparece assim que a conexão
            voltar.
          </Text>
        </Card>
      </View>
    );
  }

  if (!dados.plano) {
    return (
      <View testID={testID} style={estilos.bloco}>
        <Card titulo="Sem plano ativo">
          <Text testID="plano-vazio" style={corpo}>
            Não encontramos nenhum plano no seu cadastro. Fale com a recepção da
            academia.
          </Text>
        </Card>
      </View>
    );
  }

  const { situacao, nome, inicioEm, fimEm } = dados.plano;
  const aparencia = APARENCIA[situacao];
  const Icone = ICONE_DO_TOM[aparencia.tom];

  return (
    <View testID={testID} style={estilos.bloco}>
      <Card
        titulo="Seu plano"
        destaque
        acessorio={
          <Badge
            tom={aparencia.tom}
            texto={aparencia.texto}
            icone={<Icone />}
            testID="plano-situacao"
          />
        }
      >
        {nome === null ? (
          // Cortesia, visitante, dependente: nao ha plano a nomear.
          <Ausente motivo="plano sem nome" testID="plano-nome-ausente" />
        ) : (
          <Text
            style={{
              color: t.cor.text.primary,
              fontSize: t.type.body.size,
              lineHeight: t.type.body.lineHeight,
              fontWeight: '600',
            }}
          >
            {nome}
          </Text>
        )}

        <View style={estilos.linha}>
          <Text style={corpo}>Início</Text>
          <Text style={corpo}>{formatarData(inicioEm)}</Text>
        </View>

        <View style={estilos.linha}>
          <Text style={corpo}>Válido até</Text>
          <Text style={corpo}>{formatarData(fimEm)}</Text>
        </View>
      </Card>
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
