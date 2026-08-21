'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { Button, useToastDeErro } from '@arenahub/ui';

import { enviarArquivos, type EstadoDoEnvio } from '../../../../actions/assessment-imports';

const ESTADO_INICIAL: EstadoDoEnvio = {};

/**
 * Tipos que a API aceita (`arquivo-de-importacao.ts`).
 *
 * O `accept` é conveniência do seletor, NÃO validação: o tipo real é
 * decidido no servidor pela assinatura dos primeiros bytes, porque extensão
 * é controlada por quem envia.
 */
const TIPOS_ACEITOS = '.csv,.pdf,.png,.jpg,.jpeg';

interface Props {
  readonly studentId: string;
}

/**
 * Envio dos laudos do mês.
 *
 * MÚLTIPLOS ARQUIVOS DE UMA VEZ, de propósito: a medição da academia produz
 * três arquivos do MESMO instante (balança, app da balança, ECG), e enviá-los
 * um a um abriria três sessões -- três avaliações separadas para uma medição
 * só, que é o defeito que esta fatia existe para impedir.
 *
 * Nada é gravado como histórico aqui: o upload extrai e abre a revisão. Só a
 * confirmação campo a campo cria a avaliação (INV-103).
 */
export function EnvioDeLaudos({ studentId }: Props) {
  const [estado, acao] = useActionState(enviarArquivos, ESTADO_INICIAL);
  const [quantidade, setQuantidade] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useToastDeErro(estado.erro, 'error', `erro-envio-${studentId}`);

  const sessaoCriada = estado.sucesso?.sessionId;

  /*
    Sucesso leva direto à revisão: o avaliador acabou de enviar para
    conferir, e devolvê-lo a esta tela o obrigaria a procurar a sessão que
    ele mesmo acabou de criar.

    Em efeito, e não no corpo do componente: navegar durante o render é
    efeito colateral no meio da renderização, e o React avisa (ou dispara
    duas vezes em modo estrito).
  */
  useEffect(() => {
    if (sessaoCriada === undefined) return;

    if (entrada.current !== null) entrada.current.value = '';

    router.push(`/students/${studentId}/health/imports/${sessaoCriada}`);
  }, [sessaoCriada, studentId, router]);

  return (
    <form action={acao} data-testid="envio-de-laudos">
      <input type="hidden" name="studentId" value={studentId} />

      <label htmlFor="arquivos-do-laudo">
        Laudos da avaliação
        <input
          ref={entrada}
          id="arquivos-do-laudo"
          name="arquivos"
          type="file"
          multiple
          accept={TIPOS_ACEITOS}
          onChange={(evento) => setQuantidade(evento.target.files?.length ?? 0)}
          data-testid="seletor-de-laudos"
        />
      </label>

      <p>
        Envie os arquivos da mesma medição juntos — balança, análise e ECG. Eles viram{' '}
        <strong>uma</strong> avaliação depois da sua conferência campo a campo.
      </p>

      <BotaoDeEnvio quantidade={quantidade} />
    </form>
  );
}

function BotaoDeEnvio({ quantidade }: { readonly quantidade: number }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="solid" disabled={pending || quantidade === 0}>
      {pending
        ? 'Enviando…'
        : quantidade === 0
          ? 'Enviar laudos'
          : `Enviar ${quantidade} arquivo${quantidade > 1 ? 's' : ''}`}
    </Button>
  );
}
