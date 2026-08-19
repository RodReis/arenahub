import type { ReactNode } from 'react';

import estilos from './Identidade.module.css';

interface Props {
  /** O nome, matrícula ou código que identifica a linha. */
  readonly nome: string;
  /** Dado de apoio sob o nome: CPF mascarado, telefone, matrícula. */
  readonly secundario?: ReactNode;
  /** Quando a identidade leva a uma ficha. Sem isto, renderiza texto. */
  readonly href?: string;
  /**
   * Foto, quando houver.
   *
   * NÃO EXISTE FONTE PARA ELA HOJE, e a ausência é deliberada: o único retrato
   * que o ArenaHub guarda é a imagem BIOMÉTRICA facial, cujo consentimento
   * versionado declara finalidade de identificação na catraca — não exibição em
   * lista administrativa. Reusá-la aqui mudaria a finalidade do dado sem base
   * legal nova (LGPD art. 11), e é decisão do PI, não de componente.
   *
   * O parâmetro existe para que ligar a foto, quando a fonte for decidida, seja
   * uma linha — e não uma refatoração de treze telas.
   */
  readonly fotoUrl?: string;
  /** Esconde o avatar. Use quando a linha não é uma pessoa nem um equipamento. */
  readonly semAvatar?: boolean;
  readonly testId?: string;
}

/**
 * Identidade da linha — o bloco que ancora a leitura numa tabela densa.
 *
 * EXISTIA DUAS VEZES antes deste componente: `.identificacao` em `/students` e
 * `.identidade` em `/billing/delinquency`, com `gap` e `padding` levemente
 * diferentes. Mesmo padrão escrito por duas pessoas em dois meses — que é
 * exatamente como um sistema deixa de ser um sistema.
 *
 * O AVATAR NÃO É ENFEITE. Numa tabela de quarenta linhas, a marca circular é o
 * que o olho encontra antes de ler qualquer letra: varrer verticalmente por
 * forma é mais rápido que por texto, e a recepção varre com o aluno esperando.
 *
 * É CARBONO, e não uma paleta de tons por pessoa. Seis cores distintas
 * exigiriam primitivos novos, e os cinco semânticos que existem são reservados
 * a ESTADO (DS-PAINEL §2) — um aluno "verde" competiria com o badge "Ativo" na
 * coluna ao lado, que é a confusão que a regra existe para impedir. A distinção
 * entre linhas vem da inicial, não da cor; sóbrio é o que este painel é.
 */
export function Identidade({
  nome,
  secundario,
  href,
  fotoUrl,
  semAvatar = false,
  testId,
}: Props) {
  return (
    <span
      className={estilos['identidade']}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      {semAvatar ? null : (
        <span
          className={estilos['avatar']}
          /*
            `aria-hidden` porque o nome vem LOGO AO LADO, no mesmo bloco. Um
            leitor de tela que anunciasse "AB, Ana Beatriz" leria a abreviação
            e o nome inteiro — ruído para quem já recebeu a informação.
          */
          aria-hidden="true"
        >
          {fotoUrl === undefined ? (
            iniciaisDe(nome)
          ) : (
            /*
              `alt=""` pelo mesmo motivo do `aria-hidden`: a foto é redundante
              com o nome ao lado, e descrevê-la duplicaria o anúncio.
            */
            <img className={estilos['foto']} src={fotoUrl} alt="" loading="lazy" />
          )}
        </span>
      )}

      <span className={estilos['texto']}>
        {href === undefined ? (
          <span className={estilos['nome']}>{nome}</span>
        ) : (
          <a className={estilos['nome']} href={href}>
            {nome}
          </a>
        )}
        {secundario === undefined ? null : (
          <span className={estilos['secundario']}>{secundario}</span>
        )}
      </span>
    </span>
  );
}

/**
 * Até duas iniciais: primeira palavra e última.
 *
 * "Ana Beatriz Souza Lima" vira "AL", não "ABSL" — quatro letras num círculo de
 * 32 px ficam ilegíveis, e o que o avatar precisa fazer é ser DISTINTO na
 * varredura, não soletrar o nome.
 */
export function iniciaisDe(nome: string): string {
  const palavras = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);

  if (palavras.length === 0) return '?';

  const primeira = palavras[0]?.[0] ?? '';
  const ultima = palavras.length > 1 ? (palavras[palavras.length - 1]?.[0] ?? '') : '';

  return (primeira + ultima).toUpperCase();
}
