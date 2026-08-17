'use client';

import { useId, useState } from 'react';

import { Button } from './Button.js';
import estilos from './SensitiveAction.module.css';

interface Props {
  /**
   * VERBO REAL: "Revogar biometria", "Estornar pagamento" -- nunca "OK"
   * (DS-PAINEL.md §6). Quem le o botao tem de saber o que vai acontecer sem
   * reler o resumo.
   */
  readonly verb: string;
  /** O efeito por extenso, na linguagem de quem opera. */
  readonly summary: string;
  readonly onConfirm: (reason: string) => void;
  readonly onCancel: () => void;
}

/**
 * Padrao compartilhado por override manual, revogacao biometrica, estorno,
 * pagamento manual acima do limite e kill switch -- DS-PAINEL.md §8.3.
 *
 * Extraido do `formulario-de-override.tsx`, que ja implementava a forma certa:
 * resumo do efeito, motivo obrigatorio e verbo real no botao.
 *
 * Motivo OBRIGATORIO nao e burocracia -- e o que transforma a acao em registro
 * auditavel. Sem ele, a auditoria mostra "fulano revogou" e nunca "por que".
 */
export function SensitiveAction({ verb, summary, onConfirm, onCancel }: Props) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState(false);
  const idMotivo = useId();

  const confirmar = (): void => {
    const limpo = motivo.trim();

    if (limpo === '') {
      setErro(true);

      return;
    }

    onConfirm(limpo);
  };

  return (
    <div className={estilos['caixa']} role="dialog" aria-label={verb}>
      <p className={estilos['resumo']}>{summary}</p>

      <label htmlFor={idMotivo}>Motivo (obrigatório)</label>
      {/*
        Controlado, e o motivo NUNCA e limpo no erro -- §10 item 3. Perder o
        texto digitado e a forma mais rapida de fazer alguem desistir de
        escrever motivo de verdade.
      */}
      <textarea
        id={idMotivo}
        className={estilos['motivo']}
        value={motivo}
        rows={3}
        onChange={(evento) => {
          setMotivo(evento.target.value);
          setErro(false);
        }}
      />

      {erro ? (
        <p role="alert" className={estilos['erro']}>
          Escreva o motivo antes de continuar.
        </p>
      ) : null}

      <div className={estilos['acoes']}>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="destructive" onClick={confirmar}>
          {verb}
        </Button>
      </div>
    </div>
  );
}
