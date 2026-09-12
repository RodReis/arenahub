import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessao } from '@/auth/sessao';
import { FormularioDeLogin } from '@/features/auth/formulario-de-login';
import { useTema } from '@/ui/theme';
import { TENANT_SLUG } from '@/config';

/**
 * Login -- DS-APP.md §3.2: a unica tela fora do shell de abas.
 *
 * O SLUG DA ACADEMIA NAO E DIGITADO PELO ALUNO. Ele vem da configuracao do
 * build (`EXPO_PUBLIC_TENANT_SLUG`): pedir ao aluno que saiba o
 * identificador tecnico da propria academia seria transferir a ele um
 * detalhe de implementacao. No piloto ha um cliente; quando houver mais, a
 * escolha e por build proprio ou por tela de selecao -- decisao de produto,
 * nao deste arquivo.
 */
export default function Entrar() {
  const t = useTema();
  const inset = useSafeAreaInsets();
  const { entrar } = useSessao();

  return (
    <ScrollView
      style={{ backgroundColor: t.cor.bg.app }}
      contentContainerStyle={[
        estilos.conteudo,
        { paddingTop: Math.max(inset.top, t.size.safeAreaTop) + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={estilos.cabecalho}>
        <Text
          style={{
            color: t.cor.text.primary,
            fontSize: t.type.loginTitle.size,
            lineHeight: t.type.loginTitle.lineHeight,
            fontWeight: '700',
          }}
        >
          Clínica de Musculação
        </Text>
        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
          }}
        >
          Disciplina hoje, resultados sempre.
        </Text>
      </View>

      <FormularioDeLogin
        onEntrar={({ identificador, senha }) =>
          entrar({ tenantSlug: TENANT_SLUG, identificador, senha })
        }
        onEsqueciSenha={() => router.push('/recuperar')}
      />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 24,
  },
  cabecalho: {
    gap: 6,
  },
});
