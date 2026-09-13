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
  /**
   * Avisos nao lidos -- F29.
   *
   * OPCIONAL: vem de uma segunda chamada, e a Home tem de renderizar antes
   * dela voltar. `undefined` e "ainda nao sei", que e diferente de zero --
   * mostrar "(0)" enquanto carrega seria afirmar algo que ninguem apurou.
   */
  readonly naoLidos?: number;
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
  onVerPlano,
  onVerFrequencia,
  onVerAvisos,
  testID,
}: {
  dados: DadosDaHome;
  onSair: () => void;
  onAtualizarApp: () => void;
  onVerPlano: () => void;
  onVerFrequencia: () => void;
  onVerAvisos: () => void;
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
            Consulte seu plano e sua frequência. A carteirinha chega numa próxima
            atualização.
          </Text>
          <Botao titulo="Meu plano" emCard onPress={onVerPlano} testID="botao-plano" />
          <Botao
            titulo="Minha frequência"
            variante="neutro"
            emCard
            onPress={onVerFrequencia}
            testID="botao-frequencia"
          />
          {/*
            O contador entra no TITULO do botao -- F29.

            Nao ha bolinha sobreposta porque nao ha barra de abas neste app: o
            atalho e um botao numa lista, e numero entre parenteses e o que
            leitor de tela anuncia sem marcacao extra.
          */}
          <Botao
            titulo={
              dados.naoLidos !== undefined && dados.naoLidos > 0
                ? `Meus avisos (${dados.naoLidos})`
                : 'Meus avisos'
            }
            variante="neutro"
            emCard
            onPress={onVerAvisos}
            testID="botao-avisos"
          />
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
