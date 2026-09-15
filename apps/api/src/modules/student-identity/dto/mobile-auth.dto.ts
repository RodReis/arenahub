import { z } from 'zod';

/**
 * Contrato de entrada do canal mobile.
 *
 * `.strict()` em todos: campo desconhecido e ERRO, nao silencio. Aceitar
 * extra deixa o cliente mandar `{ senha, tenantId }` e alguem, um dia,
 * passar a ler o tenant do corpo -- exatamente o que a regra de arquitetura
 * no 2 proibe.
 */

/** Piso de 10 caracteres -- a politica esta no servico; aqui e so formato. */
const senha = z.string().min(1).max(200);

/**
 * CPF so digitos -- SPEC-071. Formato aqui, digito verificador e
 * `cpfEhValido` (domain/identificacao.ts) ficam fora: o dono de um CPF
 * cadastrado errado ainda precisa conseguir usar o primeiro acesso com o
 * numero que foi gravado, entao o DTO nao pode recusar o que o cadastro
 * aceitou.
 */
const cpf = z
  .string()
  .trim()
  .transform((valor) => valor.replace(/\D/g, ''))
  .pipe(z.string().length(11));

/** `YYYY-MM-DD` ou ISO completo -- o app manda o que o seletor de data der. */
const dataNascimento = z.coerce.date();

/**
 * O tenant entra POR SLUG, e nao por id.
 *
 * Isto nao contraria a regra no 2: aqui ainda NAO existe identidade
 * autenticada -- e o login que a cria. O slug diz "qual academia", como o
 * subdominio faz na web. A partir do token emitido, o tenant sai SEMPRE
 * dos claims, e nunca mais do corpo.
 */
const tenantSlug = z.string().min(1).max(120);

/** Rotulo do aparelho, para a lista de sessoes. Opaco, nunca IMEI. */
const deviceLabel = z.string().max(60).optional();

export const ativarDto = z
  .object({
    token: z.string().min(1),
    senha,
  })
  .strict();

/**
 * Login -- SPEC-071 §3 decisao 3 e §7. A UI (F71) so mostra CPF, mas o
 * corpo aceita `cpf` OU `identificador` (e-mail/telefone, F23): quem ja
 * ativou pelo convite antes desta fatia nao pode ficar sem entrar. Exige
 * EXATAMENTE um dos dois -- nunca os dois, nunca nenhum.
 */
export const loginDto = z
  .object({
    tenantSlug,
    cpf: cpf.optional(),
    identificador: z.string().min(1).max(320).optional(),
    senha,
    deviceLabel,
  })
  .strict()
  .refine((dados) => Boolean(dados.cpf) !== Boolean(dados.identificador), {
    message: 'informe cpf ou identificador, nunca os dois nem nenhum',
  });

/**
 * Consulta do primeiro acesso (ativacao self-service) -- SPEC-071 §6.2/§7.
 * Localiza o aluno pelo CPF + nascimento e devolve os dados da tela de
 * confirmacao (§6.3) mais um `activationRef` de curta duracao. CPF + data
 * aqui NAO autenticam sessao -- so `ativacaoSelfServiceDto`, com a senha
 * escolhida, autentica.
 */
export const ativacaoConsultaDto = z
  .object({
    tenantSlug,
    cpf,
    dataNascimento,
  })
  .strict();

/**
 * Confirmacao do primeiro acesso -- SPEC-071 §7. O `activationRef` (emitido
 * pela consulta) prova que o CPF + nascimento ja foram conferidos; o corpo
 * so acrescenta a senha escolhida, duas vezes.
 */
export const ativacaoSelfServiceDto = z
  .object({
    activationRef: z.string().min(1),
    senha,
    confirmacaoSenha: z.string().min(1).max(200),
  })
  .strict()
  .refine((dados) => dados.senha === dados.confirmacaoSenha, {
    message: 'senha e confirmacaoSenha precisam ser iguais',
    path: ['confirmacaoSenha'],
  });

export const refreshDto = z
  .object({
    refreshToken: z.string().min(1),
  })
  .strict();

/** Pede recuperacao -- sempre aceita, nunca revela (F23, inalterado pela SPEC-071). */
export const recuperacaoDto = z
  .object({
    tenantSlug,
    identificador: z.string().min(1).max(320),
  })
  .strict();

export const confirmarRecuperacaoDto = z
  .object({
    token: z.string().min(1),
    senha,
  })
  .strict();

export const reautenticarDto = z
  .object({
    senha,
  })
  .strict();

export type AtivarEntrada = z.infer<typeof ativarDto>;
export type LoginEntrada = z.infer<typeof loginDto>;
export type AtivacaoConsultaEntrada = z.infer<typeof ativacaoConsultaDto>;
export type AtivacaoSelfServiceEntrada = z.infer<typeof ativacaoSelfServiceDto>;
export type RefreshEntrada = z.infer<typeof refreshDto>;
export type RecuperacaoEntrada = z.infer<typeof recuperacaoDto>;
export type ConfirmarRecuperacaoEntrada = z.infer<typeof confirmarRecuperacaoDto>;
export type ReautenticarEntrada = z.infer<typeof reautenticarDto>;
