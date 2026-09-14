import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { useSessao } from '@/auth/sessao';
import { Botao } from '@/ui/Botao';
import { Card } from '@/ui/Card';
import { Tela, TituloDaTela, Voltar } from '@/ui/Tela';
import { useTema } from '@/ui/theme';

interface Exportacao {
  readonly id: string;
  readonly status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly rowCount: number;
  readonly errorCode: string | null;
  readonly expiresAt: string | null;
}

/** Intervalo entre consultas enquanto o arquivo nao fica pronto. */
const INTERVALO_MS = 1500;

/**
 * O que cada estado diz ao aluno.
 *
 * O texto do estado em processamento diz o que acontece SE ELE SAIR da tela
 * -- DS-APP §4.10: nunca prender o aluno numa tela de espera.
 */
const TEXTO: Record<Exportacao['status'], { titulo: string; descricao: string }> = {
  PENDING: {
    titulo: 'Preparando seu arquivo',
    descricao: 'Pode sair desta tela. O arquivo continua sendo preparado.',
  },
  RUNNING: {
    titulo: 'Preparando seu arquivo',
    descricao: 'Pode sair desta tela. O arquivo continua sendo preparado.',
  },
  COMPLETED: {
    titulo: 'Arquivo pronto',
    descricao: 'O link vale por poucos minutos. Se expirar, peça de novo.',
  },
  FAILED: {
    titulo: 'Não deu para preparar o arquivo',
    descricao: 'Tente pedir de novo. Se continuar, fale com a recepção.',
  },
  CANCELLED: {
    titulo: 'Pedido cancelado',
    descricao: 'Peça de novo quando quiser.',
  },
};

/**
 * Exportacao do historico corporal -- Slice 4.4, `M4-FR-013`.
 *
 * ASSINCRONA: o pedido volta na hora e a tela consulta ate ficar pronto. O
 * link so e pedido no toque do aluno, e nao a cada consulta -- cada chamada
 * cria uma URL viva por minutos para um arquivo de dado de saude.
 */
export default function TelaDeExportacao() {
  const t = useTema();
  const { estado, cliente } = useSessao();

  const [job, setJob] = useState<Exportacao | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * O timer vive numa ref para o efeito de limpeza alcança-lo mesmo quando a
   * tela sai no meio de uma consulta: sem isso, o `setTimeout` dispararia
   * depois da desmontagem e o `setJob` cairia num componente que nao existe.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emAndamento = job?.status === 'PENDING' || job?.status === 'RUNNING';

  const consultar = useCallback(
    async (jobId: string) => {
      try {
        setJob((await cliente.get(`/api/v1/mobile/exportacoes/${jobId}`)) as Exportacao);
      } catch {
        setErro('Não foi possível verificar o andamento. Tente de novo em instantes.');
      }
    },
    [cliente],
  );

  useEffect(() => {
    if (!emAndamento || job === null) return;

    timer.current = setTimeout(() => void consultar(job.id), INTERVALO_MS);

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [emAndamento, job, consultar]);

  const pedir = useCallback(() => {
    setPedindo(true);
    setErro(null);

    void (async () => {
      try {
        setJob(
          (await cliente.post('/api/v1/mobile/exportacoes', {
            // Chave do CLIENTE: o retry de rede usa a mesma e o servidor
            // devolve o mesmo pedido, em vez de preparar dois arquivos.
            idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          })) as Exportacao,
        );
      } catch {
        setErro('Não foi possível pedir o arquivo agora. Tente de novo em instantes.');
      } finally {
        setPedindo(false);
      }
    })();
  }, [cliente]);

  const baixar = useCallback(() => {
    if (job === null) return;

    void (async () => {
      try {
        const { downloadUrl } = (await cliente.post(
          `/api/v1/mobile/exportacoes/${job.id}/download`,
        )) as { downloadUrl: string };

        await Linking.openURL(downloadUrl);
      } catch {
        setErro('O link expirou ou não pôde ser aberto. Peça o arquivo de novo.');
      }
    })();
  }, [cliente, job]);

  if (estado.tipo === 'ANONIMO') return <Redirect href="/entrar" />;

  const texto = job === null ? null : TEXTO[job.status];

  return (
    <Tela>
      <Voltar rotulo="Voltar" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/perfil'))} />
      <TituloDaTela>Exportar histórico</TituloDaTela>
      <Card testID="exportacao">
        <Text
          style={{
            color: t.cor.text.primary,
            fontSize: t.type.cardTitle.size, fontFamily: t.fonte(600),
            lineHeight: t.type.cardTitle.lineHeight,
          }}
        >
          Levar meus dados
        </Text>

        <Text
          style={{
            color: t.cor.text.secondary,
            fontSize: t.type.body.size, fontFamily: t.fonte(400),
            lineHeight: t.type.body.lineHeight,
            marginTop: 6,
          }}
        >
          Você recebe um arquivo com todas as suas avaliações: medidas, datas e origem.
        </Text>

        {texto !== null && (
          <View style={estilos.estado} testID="exportacao-estado">
            <Text style={{ color: t.cor.text.primary, fontSize: 15, fontFamily: t.fonte(600),}}>
              {texto.titulo}
            </Text>
            <Text
              style={{
                color: t.cor.text.secondary,
                fontSize: t.type.body.size, fontFamily: t.fonte(400),
                lineHeight: t.type.body.lineHeight,
              }}
            >
              {texto.descricao}
            </Text>
          </View>
        )}

        {erro !== null && (
          <Text style={{ color: t.cor.state.err, fontSize: 13, fontFamily: t.fonte(400), marginTop: 12 }} testID="exportacao-erro">
            {erro}
          </Text>
        )}

        <View style={estilos.acoes}>
          {job?.status === 'COMPLETED' ? (
            <Botao titulo="Baixar arquivo" onPress={baixar} emCard testID="exportacao-baixar" />
          ) : (
            <Botao
              titulo={emAndamento ? 'Preparando…' : 'Pedir meus dados'}
              onPress={pedir}
              emCard
              carregando={pedindo || emAndamento}
              testID="exportacao-pedir"
            />
          )}
        </View>
      </Card>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  conteudo: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  estado: {
    marginTop: 16,
    gap: 4,
  },
  acoes: {
    marginTop: 20,
  },
});
