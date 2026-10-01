'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { publicarTermoBiometrico, type EstadoDoTermo } from '../../../actions/termo-biometrico';

export interface TermoVigente {
  id: string;
  version: number;
  purpose: string;
  content: string;
  effectiveFrom: string;
}

interface Props {
  readonly vigente: TermoVigente | null;
}

/*
 * RASCUNHO da primeira versão -- decisão do PI em 01/10/2026 ("rascunho
 * seu"). É só o texto inicial do campo: nada é publicado sem alguém revisar
 * e apertar o botão. Academia que já tem termo nunca o vê -- o campo abre
 * com o texto vigente.
 */
export const FINALIDADE_DO_RASCUNHO =
  'Identificar o aluno por reconhecimento facial na entrada da academia, para liberar a catraca.';

export const TEXTO_DO_RASCUNHO = `TERMO DE CONSENTIMENTO PARA USO DE BIOMETRIA FACIAL

Ao aceitar este termo, autorizo a academia a cadastrar e usar a biometria do meu rosto com uma única finalidade: identificar-me na entrada para liberar a catraca.

1. O que é usado: o cadastro facial feito no leitor da academia.
2. Para que serve: somente para o controle de acesso às dependências da academia.
3. É opcional: quem não quiser usar biometria entra por outro meio (cartão, QR Code, código ou liberação pela recepção), sem nenhum prejuízo.
4. Revogação: posso retirar este consentimento a qualquer momento na recepção. A partir daí a biometria deixa de liberar o meu acesso e o cadastro facial é apagado do equipamento.
5. Compartilhamento: a biometria não é vendida nem compartilhada com terceiros.`;

const ESTADO_INICIAL: EstadoDoTermo = {};

function BotaoDePublicar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="publicar-termo">
      {pending ? 'Publicando…' : 'Publicar termo'}
    </Button>
  );
}

/**
 * Publica uma versão nova do termo biométrico (issue #491).
 *
 * A versão não é digitada: é a vigente + 1. A API recusa versão repetida
 * (`@@unique([tenantId, type, version])`), e pedir o número a quem só quer
 * corrigir um parágrafo é pedir um erro.
 */
export function FormularioDoTermo({ vigente }: Props) {
  const [estado, acao] = useActionState(publicarTermoBiometrico, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-do-termo-biometrico');

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="termo-publicado">
        <p>
          Termo biométrico <strong>versão {estado.sucesso.version}</strong> publicado.
        </p>
        <p role="note" className={estilos['nota']}>
          Alunos já cadastrados no leitor facial passam a ser vinculados na próxima conexão do
          leitor — reinicie o agente do PC da recepção para vincular agora.
        </p>
        <p>
          <a href="/operations">Voltar para Operação</a>
        </p>
      </div>
    );
  }

  const proximaVersao = (vigente?.version ?? 0) + 1;

  return (
    <form className={estilos['formulario']} action={acao}>
      {vigente ? (
        <p role="note" className={estilos['nota']} data-testid="termo-vigente">
          Vigente: <strong>versão {vigente.version}</strong>. Publicar cria a versão{' '}
          {proximaVersao}; quem aceitou a anterior continua com o consentimento registrado na
          versão que aceitou.
        </p>
      ) : (
        <p role="note" className={estilos['nota']} data-testid="sem-termo">
          A academia ainda <strong>não tem termo biométrico</strong>. Sem ele nenhuma biometria é
          cadastrada nem importada do leitor facial, e todo reconhecimento é negado na catraca.
          Revise o rascunho abaixo e publique.
        </p>
      )}

      <input type="hidden" name="version" value={proximaVersao} />

      <Field
        id="finalidade-do-termo"
        name="purpose"
        label="Finalidade"
        defaultValue={estado.valores?.['purpose'] ?? vigente?.purpose ?? FINALIDADE_DO_RASCUNHO}
        maxLength={500}
        required
        data-testid="campo-finalidade-do-termo"
      />

      <TextareaField
        id="texto-do-termo"
        name="content"
        label="Texto do termo"
        defaultValue={estado.valores?.['content'] ?? vigente?.content ?? TEXTO_DO_RASCUNHO}
        rows={16}
        required
        data-testid="campo-texto-do-termo"
      />

      <div className={estilos['acoes']}>
        <BotaoDePublicar />
        <Button href="/operations" variant="ghost">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
