'use client';

import { useEffect, useState } from 'react';

import {
  atualizarPerfilPublico,
  atualizarPreferenciaDeRanking,
  carregarPreferencias,
  type PerfilPublicoDoTotem,
  type PreferenciasDoTotem,
  type SessaoDoAluno,
} from '../lib/kiosk-client';
import { Toast } from './toast';

/**
 * Preferencia de engajamento e identidade publica no totem -- F30, Task 8.
 *
 * DUAS SECOES, e so duas. `finalidades` traz as quatro chaves do dominio
 * (RANKING, CHALLENGE, ENGAGEMENT_PUSH, PHYSICAL_EVOLUTION_RANKING) porque o
 * banco ja as suporta para F31-F35 nao precisarem de migration -- mas so
 * RANKING tem consumidor aqui. Interruptor para uma finalidade dormente
 * seria pior que ausencia: prometeria um efeito que nenhuma tela le.
 *
 * O INTERRUPTOR DE RANKING NASCE LIGADO -- regime opt-out (decisao do PI).
 * O aluno participa por padrao e sai se quiser; se a tela nascesse desligada
 * ele acharia que esta fora enquanto continua aparecendo no ranking. Isso
 * so vale enquanto a chamada ainda nao respondeu: o valor real vem do
 * servidor assim que `carregarPreferencias` resolve.
 */

const NENHUMA_TECLA_PRESSIONADA = '';

type Carga =
  | { fase: 'carregando' }
  | { fase: 'pronto'; dados: PreferenciasDoTotem }
  | { fase: 'falhou' };

const TECLADO = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
  'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
  'u', 'v', 'w', 'x', 'y', 'z', 'apagar',
] as const;

export function Preferencias({
  sessao,
  aoVoltar,
}: {
  readonly sessao: SessaoDoAluno;
  readonly aoVoltar: () => void;
}) {
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    void carregarPreferencias(sessao.sessionId, sessao.token).then((dados) => {
      if (!vivo) return;

      setCarga(dados === null ? { fase: 'falhou' } : { fase: 'pronto', dados });
    });

    return () => {
      vivo = false;
    };
  }, [sessao.sessionId, sessao.token]);

  const alternarRanking = (participa: boolean) => {
    if (carga.fase !== 'pronto') return;

    // Otimista: o toque troca a tela na hora, e desfaz se o servidor recusar.
    const anterior = carga.dados;
    setCarga({ fase: 'pronto', dados: { ...anterior, finalidades: { ...anterior.finalidades, RANKING: participa } } });

    void atualizarPreferenciaDeRanking(sessao.sessionId, sessao.token, participa).then((resultado) => {
      if (resultado === null) {
        setCarga({ fase: 'pronto', dados: anterior });
        setErro('Não foi possível salvar agora. Procure a recepção.');
        return;
      }

      setCarga({ fase: 'pronto', dados: resultado });
    });
  };

  const salvarPerfil = (
    identityChoice: 'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO',
    alias: string | null,
  ) => {
    if (carga.fase !== 'pronto') return;

    const versaoAtual = carga.dados.perfil?.version ?? null;

    void atualizarPerfilPublico(sessao.sessionId, sessao.token, identityChoice, alias, versaoAtual).then(
      (resultado) => {
        if (resultado === null) {
          setErro('Não foi possível salvar agora. Procure a recepção.');
          return;
        }

        setCarga((atual) =>
          atual.fase === 'pronto' ? { fase: 'pronto', dados: { ...atual.dados, perfil: resultado } } : atual,
        );
      },
    );
  };

  return (
    <div className="telaInterna">
      <h1 className="tituloDeTela">Minhas preferências</h1>

      {carga.fase === 'carregando' && <p className="corpo">Carregando…</p>}

      {carga.fase === 'falhou' && (
        <p className="corpo" data-testid="preferencias-falhou">
          Não foi possível carregar agora. Procure a recepção.
        </p>
      )}

      {carga.fase === 'pronto' && (
        <>
          <SecaoDeRanking
            participa={carga.dados.finalidades['RANKING'] ?? true}
            aoAlternar={alternarRanking}
          />
          <SecaoDeIdentidade
            perfil={carga.dados.perfil}
            nomeExibido={carga.dados.nomeExibido}
            aoSalvar={salvarPerfil}
          />
        </>
      )}

      <span style={{ flex: 1 }} />

      <button type="button" className="botaoSecundario" onClick={aoVoltar}>
        Voltar
      </button>

      <Toast mensagem={erro} aoSumir={() => setErro(null)} />
    </div>
  );
}

/**
 * Aparecer no ranking -- interruptor OPT-OUT, ligado por padrao.
 *
 * `role="switch"` + `aria-checked`: e o mapeamento ARIA correto para um
 * toggle binario, e o que a suite consulta com `getByRole('switch')`. O
 * `<button>` nativo mantem teclado e leitor de tela sem reimplementar nada.
 */
function SecaoDeRanking({
  participa,
  aoAlternar,
}: {
  readonly participa: boolean;
  readonly aoAlternar: (participa: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        padding: '28px 32px',
        borderRadius: 'var(--tt-raio-card)',
        border: 'var(--tt-borda) solid var(--ah-totem-border-default)',
        background: 'var(--ah-totem-bg-surface)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 'var(--tt-card-titulo)', fontWeight: 700 }}>Aparecer no ranking</span>
        <p className="metadado">
          A saída vale a partir da próxima publicação do ranking. Você pode religar quando quiser.
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={participa}
        aria-label="Aparecer no ranking"
        data-testid="interruptor-ranking"
        onClick={() => aoAlternar(!participa)}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          width: 96,
          height: 52,
          padding: 6,
          borderRadius: 'var(--tt-raio-pill)',
          border: 'none',
          justifyContent: participa ? 'flex-end' : 'flex-start',
          background: participa ? 'var(--ah-totem-brand-500)' : 'var(--ah-totem-border-default)',
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--ah-totem-text-primary)',
          }}
        />
      </button>
    </div>
  );
}

/** As tres opcoes de identidade -- DS-TOTEM.md §5.8 (F30). */
function SecaoDeIdentidade({
  perfil,
  nomeExibido,
  aoSalvar,
}: {
  readonly perfil: PerfilPublicoDoTotem | null;
  readonly nomeExibido: string;
  readonly aoSalvar: (identityChoice: 'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO', alias: string | null) => void;
}) {
  const [rascunho, setRascunho] = useState<'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO'>(
    perfil?.identityChoice ?? 'PRIMEIRO_NOME',
  );
  const [apelido, setApelido] = useState(NENHUMA_TECLA_PRESSIONADA);

  const emAnalise = perfil?.status === 'PENDING';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        padding: '28px 32px',
        borderRadius: 'var(--tt-raio-card)',
        border: 'var(--tt-borda) solid var(--ah-totem-border-default)',
        background: 'var(--ah-totem-bg-surface)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 'var(--tt-card-titulo)', fontWeight: 700 }}>Meu nome no ranking</span>
        <p className="metadado" data-testid="nome-exibido">
          Nome exibido hoje: {nomeExibido}
        </p>
        {emAnalise && (
          <p className="metadado" data-testid="apelido-em-analise">
            Apelido enviado. Em análise até um moderador aprovar.
          </p>
        )}
      </div>

      <fieldset
        style={{ display: 'flex', gap: 16, border: 'none', margin: 0, padding: 0 }}
      >
        <legend
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
          }}
        >
          Como seu nome aparece no ranking
        </legend>

        {(
          [
            { valor: 'PRIMEIRO_NOME', rotulo: 'Primeiro nome' },
            { valor: 'APELIDO', rotulo: 'Apelido' },
            { valor: 'ANONIMO', rotulo: 'Anônimo' },
          ] as const
        ).map((opcao) => (
          <label
            key={opcao.valor}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              minHeight: 'var(--tt-alvo-secundario)',
              padding: '0 20px',
              borderRadius: 20,
              border: `var(--tt-borda) solid ${
                rascunho === opcao.valor ? 'var(--ah-totem-brand-500)' : 'var(--ah-totem-border-default)'
              }`,
              background:
                rascunho === opcao.valor
                  ? 'color-mix(in srgb, var(--ah-totem-brand-500) 10%, var(--ah-totem-bg-base))'
                  : 'transparent',
              fontWeight: 600,
            }}
          >
            <input
              type="radio"
              name="identidade"
              value={opcao.valor}
              checked={rascunho === opcao.valor}
              onChange={() => setRascunho(opcao.valor)}
              style={{ width: 28, height: 28 }}
            />
            {opcao.rotulo}
          </label>
        ))}
      </fieldset>

      {rascunho === 'APELIDO' && (
        <TecladoDeApelido
          apelido={apelido}
          aoDigitar={setApelido}
          aoSalvar={() => {
            aoSalvar('APELIDO', apelido);
          }}
        />
      )}

      {rascunho !== 'APELIDO' && (
        <button
          type="button"
          className="botaoSecundario"
          onClick={() => {
            aoSalvar(rascunho, null);
          }}
        >
          Salvar
        </button>
      )}
    </div>
  );
}

/**
 * Teclado alfabetico na tela -- mesmo raciocinio do teclado numerico de
 * `identificacao-cpf.tsx`: o totem nao pode abrir o teclado do sistema
 * operacional sobre a propria interface.
 */
function TecladoDeApelido({
  apelido,
  aoDigitar,
  aoSalvar,
}: {
  readonly apelido: string;
  readonly aoDigitar: (valor: string) => void;
  readonly aoSalvar: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        role="textbox"
        aria-readonly
        aria-label="Apelido"
        style={{
          display: 'flex',
          alignItems: 'center',
          minHeight: 80,
          padding: '0 28px',
          borderRadius: 'var(--tt-raio-botao)',
          background: 'var(--ah-totem-bg-base)',
          border: 'var(--tt-borda) solid var(--ah-totem-border-default)',
          fontSize: 30,
          fontWeight: 600,
        }}
      >
        {apelido === NENHUMA_TECLA_PRESSIONADA ? (
          <span className="metadado">Toque nas letras abaixo</span>
        ) : (
          apelido
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 10,
        }}
      >
        {TECLADO.map((tecla) => (
          <button
            key={tecla}
            type="button"
            onClick={() => {
              aoDigitar(tecla === 'apagar' ? apelido.slice(0, -1) : apelido + tecla);
            }}
            aria-label={tecla === 'apagar' ? 'Apagar último caractere' : tecla}
            style={{
              minHeight: 56,
              border: 'var(--tt-borda) solid var(--ah-totem-border-default)',
              borderRadius: 14,
              background: 'var(--ah-totem-bg-base)',
              fontSize: 22,
              fontWeight: 700,
              textTransform: 'uppercase',
            }}
          >
            {tecla === 'apagar' ? '⌫' : tecla}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="ctaPrimario"
        disabled={apelido.length === 0}
        onClick={aoSalvar}
      >
        Salvar apelido
      </button>
    </div>
  );
}
