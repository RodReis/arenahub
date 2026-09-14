import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import { FormularioDeLogin } from '@/features/auth/formulario-de-login';
import { BoasVindas } from '@/features/boas-vindas/boas-vindas';
import { Folha } from '@/ui/Folha';
import { ProvedorDeTema, useTema } from '@/ui/theme';
import { TENANT_SLUG } from '@/config';

/**
 * Entrada de quem nao tem sessao -- App Mobile v2: a abertura com a arte 3D e
 * o login numa folha por cima dela.
 *
 * A ROTA CONTINUA SENDO `/entrar`: toda guarda do app redireciona para ca, e
 * a F23 ja registrou o que acontece quando so uma porta sabe sair do login.
 *
 * O SLUG DA ACADEMIA NAO E DIGITADO PELO ALUNO. Ele vem da configuracao do
 * build (`EXPO_PUBLIC_TENANT_SLUG`): pedir ao aluno que saiba o
 * identificador tecnico da propria academia seria transferir a ele um
 * detalhe de implementacao.
 *
 * TEMA ESCURO FORCADO, nos dois temas do SO: a abertura e desenhada sobre a
 * arte, e a arte e escura (ver `BoasVindas`).
 */
export default function Entrar() {
  const { estado } = useSessao();

  /*
   * SAIR DAQUI QUANDO A SESSAO EXISTIR -- e nao so na abertura do app.
   *
   * O defeito que isto corrige so apareceu no emulador (F23): o login
   * funcionava, o estado virava `AUTENTICADO`, e a TELA NAO SAIA DO LOGIN.
   */
  if (estado.tipo === 'AUTENTICADO') return <Redirect href="/inicio" />;

  return (
    <ProvedorDeTema forcarTema="dark">
      <StatusBar style="light" />
      <Abertura />
    </ProvedorDeTema>
  );
}

function Abertura() {
  const t = useTema();
  const { entrar } = useSessao();
  const [loginAberto, setLoginAberto] = useState(false);

  return (
    <>
      <BoasVindas onEntrar={() => setLoginAberto(true)} testID="boas-vindas" />

      <Folha aberta={loginAberto} onFechar={() => setLoginAberto(false)} testID="folha-login">
        <View>
          <Text accessibilityRole="header" style={{ color: t.cor.text.primary, fontSize: 20, fontFamily: t.fonte(700) }}>
            Entrar
          </Text>
          <Text style={{ color: t.cor.text.muted, fontSize: 13, marginTop: 2, fontFamily: t.fonte(400) }}>
            Use o e-mail ou telefone cadastrado na recepção.
          </Text>
        </View>

        <FormularioDeLogin
          onEntrar={({ identificador, senha }) =>
            entrar({ tenantSlug: TENANT_SLUG, identificador, senha })
          }
          onEsqueciSenha={() => {
            setLoginAberto(false);
            router.push('/recuperar');
          }}
        />
      </Folha>
    </>
  );
}
