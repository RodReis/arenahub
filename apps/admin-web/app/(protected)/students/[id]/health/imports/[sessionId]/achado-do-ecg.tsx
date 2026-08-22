import { Ausente } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * O que o ECG reportou -- ADR-035, decisões do PI em 21/08/2026.
 *
 * MOSTRA A INFORMAÇÃO, NÃO A INTERPRETA. Achado, frequência, duração e tags
 * aparecem como o aparelho os escreveu, atribuídos a ele.
 *
 * NENHUM BOTÃO, NENHUMA CONDUTA. A RDC 657/2022 da ANVISA isenta o software
 * que apenas armazena, arquiva, transmite ou exibe dado de saúde; o que
 * enquadra como dispositivo médico é interpretar -- classificar, pontuar,
 * sinalizar gravidade, recomendar encaminhamento. Por isso nada aqui lê o
 * conteúdo do texto para decidir como exibi-lo: nem cor por gravidade, nem
 * ordem por urgência, nem badge derivado da palavra.
 */

interface Props {
  /** `extracted_attributes` do arquivo de ECG, opaco (ADR-035). */
  readonly atributos?: Record<string, unknown> | null | undefined;
  /**
   * Em que pé está o arquivo de ECG desta sessão.
   *
   * Sem isto a aba mostrava cinco traços e nada mais — e três situações
   * bem diferentes ficavam idênticas: não enviaram ECG, enviaram e o
   * extrator não conseguiu ler, enviaram e o aparelho não reportou nada.
   * Só a terceira é "não há o que mostrar"; as outras duas pedem ação de
   * quem opera.
   */
  readonly arquivo?: { readonly estado: string; readonly motivoDaFalha: string | null } | undefined;
}

/** Lê uma chave como texto, sem interpretar o conteúdo. */
function texto(atributos: Record<string, unknown> | null | undefined, chave: string): string | null {
  const valor = atributos?.[chave];

  return typeof valor === 'string' && valor !== '' ? valor : null;
}

export function AchadoDoEcg({ atributos, arquivo }: Props) {
  const achado = texto(atributos, 'ecgFinding');
  const frequencia = atributos?.['ecgHeartRate'];
  const duracao = atributos?.['ecgDurationSeconds'];
  const gravadoEm = texto(atributos, 'ecgRecordedAt');
  const observacoes = texto(atributos, 'ecgNotes');
  const bruto = atributos?.['ecgTags'];
  const tags = Array.isArray(bruto) ? bruto.filter((t): t is string => typeof t === 'string') : [];

  return (
    <section className={estilos['painel']} aria-labelledby="titulo-achado-ecg">
      <h2 id="titulo-achado-ecg">Eletrocardiograma — reportado pelo aparelho</h2>

      {/*
        A explicação vem ANTES da lista de traços: quem abre a aba e vê
        cinco "—" precisa saber o porquê no mesmo olhar, não depois de
        procurar.
      */}
      {arquivo === undefined ? (
        <p className={estilos['avisoDoAparelho']} data-testid="ecg-sem-arquivo">
          Nenhum arquivo de ECG foi enviado nesta medição.
        </p>
      ) : arquivo.estado === 'FAILED' ? (
        <p className={estilos['avisoDoAparelho']} data-testid="ecg-nao-lido">
          O arquivo de ECG foi enviado, mas o extrator não conseguiu lê-lo — traçado em PDF e foto
          tremida costumam dar nisso. O arquivo continua guardado; os valores abaixo ficam vazios
          porque nada foi extraído dele.
        </p>
      ) : null}

      {/*
        Cada par em seu `<div>`: é o que o `.listaDoAparelho` estiliza (rótulo
        à esquerda, valor à direita). Com `<dt>`/`<dd>` soltos no `<dl>`, a
        regra `> div` não pegava nada e a lista saía com a indentação nativa
        do navegador.
      */}
      <dl className={estilos['listaDoAparelho']}>
        <div>
          <dt>Análise do aparelho</dt>
          <dd data-testid="achado-ecg">{achado ?? <Ausente />}</dd>
        </div>

        <div>
          <dt>Frequência cardíaca</dt>
          <dd data-testid="ecg-frequencia">
            {typeof frequencia === 'number' ? `${frequencia} bpm` : <Ausente />}
          </dd>
        </div>

        <div>
          <dt>Duração</dt>
          <dd data-testid="ecg-duracao">
            {typeof duracao === 'number' ? `${duracao} s` : <Ausente />}
          </dd>
        </div>

        <div>
          <dt>Gravado em</dt>
          <dd data-testid="ecg-gravado-em">{gravadoEm ?? <Ausente />}</dd>
        </div>

        <div>
          <dt>Marcações</dt>
          <dd data-testid="ecg-tags">{tags.length > 0 ? tags.join(', ') : <Ausente />}</dd>
        </div>

        {/*
          OBSERVAÇÕES só aparece quando existe.
          ---------------------------------------------------------------
          É texto que quem operou o aparelho digitou, e a maioria dos laudos
          vem sem. Uma linha "Observações —" em todo ECG ocuparia espaço
          para dizer que ninguém escreveu nada; as outras cinco linhas são
          sempre esperadas, e por isso mostram o traço.

          Verbatim e nunca interpretado (ADR-035): é o mesmo tratamento do
          achado do aparelho.
        */}
        {observacoes === null ? null : (
          <div>
            <dt>Observações</dt>
            <dd data-testid="ecg-observacoes">{observacoes}</dd>
          </div>
        )}
      </dl>

      <p className={estilos['avisoDoAparelho']}>
        Estas informações são do equipamento, não da plataforma, e não constituem diagnóstico.
      </p>
    </section>
  );
}
