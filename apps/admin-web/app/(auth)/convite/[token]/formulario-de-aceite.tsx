'use client';

import { useActionState, useState } from 'react';

import { Button, PasswordField, useToastDeErro } from '@arenahub/ui';

import { aceitarConvite, type EstadoDoAceite } from '../../../actions/usuarios';
import estilos from '../../login/login.module.css';

const ESTADO_INICIAL: EstadoDoAceite = {};

/**
 * A mesma da API (`esquemaDeAceite`), repetida para a dica do campo.
 *
 * 8 desde 05/09/2026 (issue #281, decisão do PI). Terceiro dos três lugares
 * que carregam este número -- os outros são o `esquemaDeAceite` da API e o
 * `MINIMO_DE_SENHA` da Server Action.
 */
const MINIMO_DE_SENHA = 8;

/**
 * Client Component só pelo estado do formulário -- o resto da tela é
 * servidor. A senha nunca vira prop nem parâmetro de URL, e nunca volta no
 * estado de erro: devolvida como estado, reapareceria no HTML da página.
 */
export function FormularioDeAceite({ token }: { readonly token: string }) {
  const [estado, acao, enviando] = useActionState(aceitarConvite, ESTADO_INICIAL);

  /*
   * CONTROLADOS, ao contrário do login ao lado -- e a diferença é a razão de
   * a tela existir.
   *
   * Toda volta da action REMONTA os campos, e input não controlado perde o
   * valor: no login isso é a escolha certa (a senha some, o e-mail volta pelo
   * `defaultValue`), porque quem errou a senha vai digitar outra de qualquer
   * jeito. Aqui os DOIS campos são senha: um erro de digitação apagaria as
   * duas e obrigaria a redigitar 12+ caracteres duas vezes -- visto na tela,
   * não em teste, porque `getByLabelText` acha o campo vazio igual.
   *
   * O valor vive só no cliente. NÃO volta como estado da action, que é o que
   * o publicaria no HTML da página -- a regra do login continua de pé.
   */
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');

  // Erro vira TOAST -- CLAUDE.md: "sempre usar Toast para: Info, Warn e
  // error". O toast já carrega `role="alert"`.
  useToastDeErro(estado.erro, 'error', 'erro-do-aceite');

  if (estado.sucesso) {
    /*
     * NÃO REDIRECIONA SOZINHO. A conta nasce sem sessão (a API devolve `{}`
     * sem cookie) e com MFA pendente: jogar a pessoa direto no login a faria
     * digitar a senha que acabou de criar sem entender que deu certo. A
     * confirmação explícita é o que fecha o ciclo.
     */
    return (
      <div className={estilos['formulario']} data-testid="aceite-concluido">
        <p>Senha criada. Você já pode entrar no painel.</p>
        <Button href="/login">Entrar</Button>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao} noValidate>
      {/*
        O token viaja no corpo, não na URL da action: o `POST` da Server
        Action vai para a rota atual, e a rota atual já o carrega -- mas o
        corpo é o que a API lê, e depender do parâmetro de rota amarraria a
        action ao caminho.
      */}
      <input type="hidden" name="token" value={token} />

      <PasswordField
        id="password"
        name="password"
        label="Nova senha"
        autoComplete="new-password"
        required
        minLength={MINIMO_DE_SENHA}
        hint={`Ao menos ${MINIMO_DE_SENHA} caracteres.`}
        value={senha}
        onChange={(evento) => setSenha(evento.target.value)}
        invalid={Boolean(estado.erro)}
      />

      {/*
        A CONFIRMAÇÃO EXISTE PORQUE NÃO HÁ RECUPERAÇÃO DE SENHA no produto
        (ver a tela de login). Errar a digitação aqui criaria a conta com uma
        senha que ninguém sabe, e o convite é de uso único: a saída seria
        pedir outro à academia.
      */}
      <PasswordField
        id="confirmacao"
        name="confirmacao"
        label="Repita a senha"
        autoComplete="new-password"
        required
        value={confirmacao}
        onChange={(evento) => setConfirmacao(evento.target.value)}
        invalid={Boolean(estado.erro)}
      />

      <Button type="submit" disabled={enviando}>
        {enviando ? 'Criando...' : 'Criar senha e entrar'}
      </Button>
    </form>
  );
}
