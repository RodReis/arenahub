import { Ausente } from '@arenahub/ui';

import estilos from './sessao.module.css';

/**
 * Achado cardíaco reportado pelo aparelho -- ADR-035, decisão 2 do PI.
 *
 * NENHUM BOTÃO. O ArenaHub armazena e cita o texto do ECG, nunca interpreta:
 * o profissional já conversou com o aluno antes do upload, e um botão de
 * "Registrar encaminhamento" ou um badge "Exige leitura médica" faria a
 * plataforma tomar uma posição clínica que a RDC 657/2022 reserva a
 * dispositivo médico registrado.
 */

interface Props {
  readonly ecgFinding?: string | null | undefined;
}

export function AchadoDoEcg({ ecgFinding }: Props) {
  return (
    <section className={estilos['painel']} aria-labelledby="titulo-achado-ecg">
      <h2 id="titulo-achado-ecg">Achado cardíaco reportado pelo aparelho</h2>

      {ecgFinding ? (
        <p data-testid="achado-ecg">{ecgFinding}</p>
      ) : (
        <p data-testid="achado-ecg-ausente">
          <Ausente /> nenhum achado relatado pelo aparelho
        </p>
      )}

      <p className={estilos['avisoDoAparelho']}>
        Esse achado é do equipamento, não da plataforma, e não constitui diagnóstico.
      </p>
    </section>
  );
}
