'use client';

import { CONFIG_PADRAO_DO_TOTEM, type KioskConfig } from '@arenahub/api-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Atrator } from '../components/atrator';
import { IdentificacaoCpf } from '../components/identificacao-cpf';
import { MinhaArea } from '../components/minha-area';
import { BarraDeSessao, RodapeDeSessao } from '../components/rodape-de-sessao';
import { Toast } from '../components/toast';
import { contrasteEfetivo } from '../lib/aparencia';
import { abrirSessao, carregarConfig, heartbeat, type SessaoDoAluno } from '../lib/kiosk-client';
import { decidirReinicio } from '../lib/reinicio';
import { limparEstadoDaSessao, useSessao } from '../lib/use-sessao';

/** ADR-042, Decisao 3: intervalo do heartbeat que decide o reinicio da superficie. */
const INTERVALO_DE_HEARTBEAT_MS = 30_000;

/**
 * O totem inteiro -- tres estados numa rota so.
 *
 * Uma rota, e nao tres: navegacao por URL num quiosque deixa historico, e
 * historico com sessao de aluno e o botao "voltar" reabrindo a tela do
 * anterior. Estado em memoria morre com a limpeza.
 *
 * Decisao 4 do PI: mensagem UNICA e neutra para toda falha de identificacao
 * -- CPF inexistente, aluno de outro tenant, status nao elegivel e erro de
 * rede dizem a MESMA coisa. Distinguir revelaria a quem digitasse um CPF
 * qualquer se aquela pessoa treina aqui.
 */
const FALHA_DE_IDENTIFICACAO = 'Não foi possível entrar. Procure a recepção.';

type Etapa = 'atrator' | 'cpf';

export default function Totem() {
  const [config, setConfig] = useState<KioskConfig>(CONFIG_PADRAO_DO_TOTEM);
  const [etapa, setEtapa] = useState<Etapa>('atrator');
  const [sessao, setSessao] = useState<SessaoDoAluno | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // `null` = o aluno nao mexeu no interruptor; vale o padrao da unidade.
  const [contrasteDoAluno, setContrasteDoAluno] = useState<boolean | null>(null);
  // `null` ate a primeira config carregar -- `decidirReinicio` fica inerte
  // ate la (ver reinicio.ts: sem boot conhecido, nao ha o que comparar).
  const [versaoDoBoot, setVersaoDoBoot] = useState<number | null>(null);
  // Marcado quando `decidirReinicio` manda 'aguardar': a troca so acontece
  // quando esta sessao terminar, nunca no meio dela.
  const reinicioPendenteRef = useRef(false);

  const altoContraste = contrasteEfetivo(
    contrasteDoAluno,
    config.aparencia.altoContrastePadrao,
  );

  // Marca, accent, duracao e modulos vem da config DESDE O PRIMEIRO COMMIT
  // (ADR-042, Decisao 0) -- mesmo que hoje so exista o padrao do seed.
  useEffect(() => {
    void carregarConfig().then(({ version, config: carregada }) => {
      setConfig(carregada);
      setVersaoDoBoot(version);
    });
  }, []);

  /**
   * Heartbeat periodico: pergunta a versao publicada atual e decide se a
   * superficie deve reiniciar (ADR-042, Decisao 3). `sessao` entra no
   * array de dependencia para que a decisao mais recente sempre veja se ha
   * aluno na frente do totem -- reiniciar NUNCA pode interromper a sessao.
   */
  useEffect(() => {
    const emSessao = sessao !== null;

    const intervalo = setInterval(() => {
      void heartbeat().then((resposta) => {
        if (resposta === null) return;

        const decisao = decidirReinicio({
          versaoDoBoot,
          versaoAtual: resposta.configVersion,
          emSessao,
        });

        if (decisao === 'reiniciar') {
          window.location.reload();
        } else if (decisao === 'aguardar') {
          reinicioPendenteRef.current = true;
        }
      });
    }, INTERVALO_DE_HEARTBEAT_MS);

    return () => {
      clearInterval(intervalo);
    };
  }, [versaoDoBoot, sessao]);

  /**
   * Accent e contraste moram no <html>, nao num wrapper: `[data-surface]` ja
   * esta la (posto pelo layout, no servidor), e os blocos de token do
   * `theme.css` sao escritos como `[data-surface="totem"][data-accent="X"]`.
   *
   * Escrito por efeito, e nao no layout: `aparencia` vem da CONFIG, que so
   * chega depois do primeiro fetch. O padrao AZUL ja e o `--ah-totem-brand-*`
   * base, entao ate a config chegar a tela nunca fica sem cor.
   */
  useEffect(() => {
    const raiz = document.documentElement;

    raiz.dataset['accent'] = config.aparencia.accent;

    if (altoContraste) {
      raiz.dataset['contraste'] = 'alto';
    } else {
      delete raiz.dataset['contraste'];
    }
  }, [config.aparencia.accent, altoContraste]);

  const voltarAoInicio = useCallback(() => {
    setSessao(null);
    setEtapa('atrator');
    // A escolha do aluno morre com a sessao dele: o proximo nao herda a
    // preferencia do anterior, e o padrao da unidade volta a valer.
    setContrasteDoAluno(null);

    // A sessao que acabou de encerrar era a que segurava o reinicio
    // pendente (ADR-042, Decisao 3) -- agora pode acontecer.
    if (reinicioPendenteRef.current) {
      window.location.reload();
    }
  }, []);

  const alternarContraste = useCallback(() => {
    setContrasteDoAluno((atual) => !(atual ?? config.aparencia.altoContrastePadrao));
  }, [config.aparencia.altoContrastePadrao]);

  const confirmar = useCallback(async (cpf: string) => {
    setOcupado(true);
    setErro(null);

    const aberta = await abrirSessao(cpf);

    setOcupado(false);

    if (aberta === null) {
      setErro(FALHA_DE_IDENTIFICACAO);
      return;
    }

    setSessao(aberta);
  }, []);

  /**
   * Limpa tambem quando a pagina SAI -- recarregar, fechar a aba, o navegador
   * sendo morto pelo modo quiosque.
   *
   * `pagehide`, e nao o cleanup do efeito: cleanup de efeito roda quando o
   * COMPONENTE desmonta, o que nao acontece num F5 nem ao fechar a aba. Foi o
   * que a revisao pegou -- o comentario anterior prometia cobrir esses casos e
   * o codigo nao cobria.
   *
   * `pagehide` e nao `beforeunload`: o segundo nao dispara em navegador movel
   * nem quando a aba e descartada por memoria, e ainda arrisca o dialogo de
   * confirmacao. `pagehide` dispara nos dois, e tambem quando a pagina entra
   * no cache de retorno (`persisted`) -- limpar la e o que se quer: a pagina
   * pode voltar do cache com o dado do aluno anterior ainda em memoria.
   *
   * O cleanup do efeito fica junto porque desmontar tambem tem de limpar, e
   * limpar duas vezes e inofensivo (a segunda ja encontra tudo vazio).
   */
  useEffect(() => {
    const aoSair = (): void => {
      limparEstadoDaSessao();
    };

    window.addEventListener('pagehide', aoSair);

    return () => {
      window.removeEventListener('pagehide', aoSair);
      aoSair();
    };
  }, []);

  if (sessao !== null) {
    return (
      <TelaDeSessao
        sessao={sessao}
        config={config}
        aoEncerrar={voltarAoInicio}
        altoContraste={altoContraste}
        aoAlternarContraste={alternarContraste}
      />
    );
  }

  return (
    <>
      {etapa === 'atrator' ? (
        <Atrator
          config={config}
          altoContraste={altoContraste}
          aoAlternarContraste={alternarContraste}
          aoEntrar={() => {
            setEtapa('cpf');
          }}
        />
      ) : (
        <IdentificacaoCpf
          ocupado={ocupado}
          aoConfirmar={(cpf) => {
            void confirmar(cpf);
          }}
          aoVoltar={voltarAoInicio}
        />
      )}
      <Toast
        mensagem={erro}
        aoSumir={() => {
          setErro(null);
        }}
      />
    </>
  );
}

/**
 * Componente proprio para a sessao viva porque `useSessao` so pode rodar
 * quando ela EXISTE -- chamar um hook condicionalmente no componente de cima
 * quebraria a regra dos hooks; montar o hook com sessao nula obrigaria o
 * hook inteiro a tratar um estado que nao ocorre.
 */
function TelaDeSessao({
  sessao,
  config,
  aoEncerrar,
  altoContraste,
  aoAlternarContraste,
}: {
  readonly sessao: SessaoDoAluno;
  readonly config: KioskConfig;
  readonly aoEncerrar: () => void;
  readonly altoContraste: boolean;
  readonly aoAlternarContraste: () => void;
}) {
  const { segundosRestantes, fracaoRestante, estender, encerrar } = useSessao(
    sessao,
    aoEncerrar,
    config.sessao.duracaoSegundos,
  );

  return (
    <div className="tela">
      <BarraDeSessao fracaoRestante={fracaoRestante} />
      <MinhaArea sessao={sessao} config={config} />
      <RodapeDeSessao
        segundosRestantes={segundosRestantes}
        aoEstender={estender}
        aoEncerrar={encerrar}
        altoContraste={altoContraste}
        aoAlternarContraste={aoAlternarContraste}
      />
    </div>
  );
}
