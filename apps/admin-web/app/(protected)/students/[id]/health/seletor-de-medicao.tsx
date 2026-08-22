import Link from 'next/link';

import { TenantDateTime } from '@arenahub/ui';

import estilos from './health.module.css';

/**
 * O seletor de medição -- qual avaliação a tela está mostrando.
 *
 * ---------------------------------------------------------------------------
 * A MEDIÇÃO VIVE NA URL, COMO O PERÍODO DO HISTÓRICO.
 * ---------------------------------------------------------------------------
 *
 * Mesma decisão do `FiltroDePeriodo` ao lado, pelas mesmas três razões: a
 * página continua Server Component (nada para hidratar), o link é
 * compartilhável ("olha a avaliação de agosto dele") e o botão voltar do
 * navegador faz o que a recepção espera. São links de verdade -- navegação
 * por teclado e leitor de tela vêm de graça do `<a>`.
 *
 * `aria-current="page"` e não `role="tab"`: é navegação entre views, não um
 * widget de abas. Anunciar `tablist` prometeria ao leitor de tela um
 * comportamento de setas que estes links não têm.
 */

export interface MedicaoDisponivel {
  readonly sessionId: string;
  readonly assessedAt: string;
  /**
   * A sessão virou avaliação publicada.
   *
   * Quando `false`, `assessedAt` é a data do UPLOAD e não a da medição --
   * a sessão ainda não tem `assessed_at` para exibir. O rótulo diz isso em
   * vez de apresentar as duas datas como se fossem a mesma coisa.
   */
  readonly published: boolean;
}

interface Props {
  readonly studentId: string;
  readonly medicoes: readonly MedicaoDisponivel[];
  /** A que está sendo exibida -- `null` quando o aluno não tem nenhuma. */
  readonly atual: string | null;
  readonly timeZone: string;
}

/**
 * O atalho para anexar uma medição nova.
 *
 * Âncora, não botão de ação: o formulário de envio existe uma vez só, no
 * rodapé, e duplicá-lo aqui criaria dois lugares para manter em sincronia.
 * `<a href="#enviar-laudos">` leva até ele sem JavaScript, funciona com
 * teclado e leitor de tela de graça, e a página continua Server Component.
 */
function AtalhoDeEnvio() {
  return (
    <a className={estilos['novaAvaliacao']} href="#enviar-laudos" data-testid="ir-para-envio">
      <span aria-hidden="true">+</span> Nova avaliação
    </a>
  );
}

export function SeletorDeMedicao({ studentId, medicoes, atual, timeZone }: Props) {
  /*
   * Uma medição só não é escolha -- mas o ATALHO continua valendo.
   *
   * Antes o componente inteiro sumia com menos de duas medições, e junto
   * sumia o único caminho visível para anexar a próxima: quem tinha uma
   * avaliação só precisava rolar a página inteira para achar o formulário.
   */
  if (medicoes.length < 2) {
    return (
      <nav className={estilos['seletorDeMedicao']} aria-label="Medições do aluno">
        <AtalhoDeEnvio />
      </nav>
    );
  }

  /*
   * DATAS REPETIDAS PRECISAM DE DESEMPATE.
   *
   * Oito medições de meses diferentes importadas no mesmo dia, ou dois
   * laudos do mesmo dia, produzem entradas com rótulo idêntico -- e aí
   * escolher no seletor é chute. Observado ao vivo: quatro entradas
   * "21/08/2026", indistinguíveis.
   *
   * Só as datas EMPATADAS ganham a hora; as demais ficam com a data limpa,
   * que é o que se reconhece de relance.
   */
  const diaDe = (iso: string) => iso.slice(0, 10);
  const repetidas = new Set(
    medicoes
      .map((m) => diaDe(m.assessedAt))
      .filter((dia, i, todos) => todos.indexOf(dia) !== i),
  );

  return (
    <nav className={estilos['seletorDeMedicao']} aria-label="Medições do aluno">
      <p className={estilos['rotuloDoSeletor']} id="rotulo-medicoes">
        Medição
      </p>

      <ul aria-labelledby="rotulo-medicoes">
        {medicoes.map((medicao) => (
          <li key={medicao.sessionId}>
            <Link
              href={`/students/${studentId}/health?medicao=${medicao.sessionId}`}
              aria-current={medicao.sessionId === atual ? 'page' : undefined}
              data-testid={`medicao-${medicao.sessionId}`}
              scroll={false}
              /*
                A data sozinha não diz se é medição ou upload. O título
                completa para quem passa o mouse ou usa leitor de tela, sem
                poluir uma fila de oito datas com sufixo em cada uma.
              */
              title={
                medicao.published
                  ? 'Avaliação publicada'
                  : 'Laudos enviados, avaliação ainda não publicada — esta é a data do envio'
              }
            >
              <TenantDateTime
                iso={medicao.assessedAt}
                timeZone={timeZone}
                format={repetidas.has(diaDe(medicao.assessedAt)) ? 'datetime' : 'date'}
              />
              {/*
                Marca visível para a sessão não publicada: sem ela, uma data
                de upload senta na fila ao lado de datas de medição fingindo
                ser a mesma coisa.
              */}
              {medicao.published ? null : (
                <span className={estilos['medicaoPendente']} aria-hidden="true">
                  {' '}
                  ·&nbsp;envio
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <AtalhoDeEnvio />
    </nav>
  );
}
