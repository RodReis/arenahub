import { StyleSheet, Text, View } from 'react-native';

import { Botao } from '../../ui/Botao.js';
import { Card } from '../../ui/Card.js';
import { useTema } from '../../ui/theme.js';

export interface DadosDaHome {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly saudacao: string;
  readonly versionPolicy: {
    readonly state: 'SUPPORTED' | 'GRACE' | 'BLOCKED';
    readonly updateUrl: string | null;
  };
}

/**
 * Home minima -- o "shell util" do `M4-NFR-002`.
 *
 * INDISPONIVEL MOSTRA O SHELL, NUNCA O DADO ANTIGO. A tela vazia incomoda; a
 * tela que PARECE certa e esta errada engana -- e num app que fala de plano,
 * fatura e acesso, enganar custa o aluno tomar decisao sobre dado vencido.
 *
 * A Home NAO RECALCULA NADA (`M4-BR-008`): nao ha `if (vencimento < hoje)`
 * aqui. O backend manda o estado pronto e a tela escolhe cor e icone. Um
 * cliente que deriva estado financeiro inventa uma segunda autoridade sobre
 * dinheiro.
 */
export function Home({
  dados,
  onSair,
  onAtualizarApp,
  testID,
}: {
  dados: DadosDaHome;
  onSair: () => void;
  onAtualizarApp: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  if (dados.versionPolicy.state === 'BLOCKED') {
    return (
      <View testID={testID} style={[estilos.centro, { backgroundColor: t.cor.bg.app }]}>
        <Card titulo="Atualize o aplicativo">
          <Text
            style={{
              color: t.cor.text.secondary,
              fontSize: t.type.body.size,
              lineHeight: t.type.body.lineHeight,
            }}
          >
            Esta versão não é mais compatível. Atualize para continuar usando.
          </Text>
          <Botao
            titulo="Atualizar agora"
            emCard
            onPress={onAtualizarApp}
            testID="botao-atualizar"
          />
        </Card>
      </View>
    );
  }

  return (
    <View testID={testID} style={estilos.bloco}>
      <Text
        style={{
          color: t.cor.text.primary,
          fontSize: t.type.screenTitle.size,
          lineHeight: t.type.screenTitle.lineHeight,
          fontWeight: '700',
        }}
      >
        {dados.status === 'AVAILABLE' ? dados.saudacao : 'Clínica de Musculação'}
      </Text>

      {dados.status === 'UNAVAILABLE' ? (
        <Card titulo="Sem conexão com a academia">
          <Text
            style={{
              color: t.cor.text.secondary,
              fontSize: t.type.body.size,
              lineHeight: t.type.body.lineHeight,
            }}
          >
            Não foi possível atualizar agora. Seus dados aparecem assim que a conexão
            voltar.
          </Text>
        </Card>
      ) : (
        <Card titulo="Tudo pronto">
          <Text
            style={{
              color: t.cor.text.secondary,
              fontSize: t.type.body.size,
              lineHeight: t.type.body.lineHeight,
            }}
          >
            Plano, carteirinha e frequência chegam nas próximas atualizações do
            aplicativo.
          </Text>
        </Card>
      )}

      <Botao
        titulo="Sair da conta"
        variante="neutro"
        emCard
        onPress={onSair}
        testID="botao-sair"
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  bloco: {
    gap: 14,
  },
  centro: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
});
