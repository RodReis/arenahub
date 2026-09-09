'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { repassarCookies } from '../../lib/api/repassar-cookies';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Cadastro de academia pelo dono do SaaS — F61.
 *
 * A validação daqui NÃO substitui a da API: ela existe para quem cadastra ver
 * o erro sem perder o que digitou. A API valida de novo, e é ela que manda —
 * Server Action é superfície pública tanto quanto um endpoint.
 */
const esquemaDeTenant = z.object({
  /*
   * `slug` é identificador público usado em URL (F62 fará login por ele).
   * Minúsculas, números e hífen -- nada que precise de escape.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'O identificador precisa de ao menos 3 caracteres')
    .max(48, 'Identificador longo demais')
    .regex(/^[a-z0-9-]+$/, 'Use apenas minúsculas, números e hífen no identificador'),
  legalName: z.string().trim().min(1, 'Informe a razão social').max(200, 'Razão social longa demais'),
  displayName: z.string().trim().min(1, 'Informe o nome fantasia').max(120, 'Nome longo demais'),
  /*
   * Máscara ENTRA e sai só dígito: o campo aceita "12.345.678/0001-99" porque
   * é assim que se digita CNPJ, e a API exige os 14 dígitos crus. Mandar o
   * texto mascarado daria `VALIDATION_FAILED` genérico, longe da causa.
   */
  cnpj: z
    .string()
    .trim()
    .transform((valor) => valor.replace(/\D/g, ''))
    .refine((valor) => valor.length === 14, 'CNPJ precisa ter 14 dígitos'),
  /*
   * Mesmo peso que na unidade (ADR-019): o fuso decide vencimento e bloqueio,
   * sem fallback. A lista da tela é fechada; aqui a checagem é de presença.
   */
  timezone: z.string().min(1, 'Selecione o fuso horário'),
  responsavelNome: z.string().trim().min(1, 'Informe o nome do responsável').max(120),
  responsavelEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail do responsável inválido')
    .max(320),
  unidadeCode: z.string().trim().min(1, 'Informe o código da primeira unidade').max(32),
  unidadeName: z.string().trim().min(1, 'Informe o nome da primeira unidade').max(120),
});

/**
 * O que o formulário mandou, campo a campo.
 *
 * NOMEADO e não `Record<string, string>`: com o índice genérico, todo acesso
 * vira `valores?.['slug']` (regra `noPropertyAccessFromIndexSignature`) e um
 * campo com nome errado passaria batido pelo compilador -- exatamente o que a
 * devolução de valores existe para evitar.
 */
export interface ValoresDoTenant {
  slug: string;
  legalName: string;
  displayName: string;
  cnpj: string;
  timezone: string;
  responsavelNome: string;
  responsavelEmail: string;
  unidadeCode: string;
  unidadeName: string;
}

export interface EstadoDoTenant {
  erro?: string;
  sucesso?: { id: string; displayName: string; emailEnviado: boolean };
  /** Devolvidos para o formulário não perder o preenchimento em erro. */
  valores?: ValoresDoTenant;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  /*
   * A frase de `MENSAGEM_DE_SESSAO` fala de "perfil sem permissão", que aqui
   * seria enganosa: `/platform` recusa QUEM NÃO É dono do SaaS, e não há
   * permissão de tenant que resolva.
   */
  FORBIDDEN: 'Este perfil não administra a plataforma.',
  TENANT_NOT_FOUND: 'Esta academia não existe mais.',
  MOTIVO_OBRIGATORIO: 'Escreva o motivo (ao menos 10 caracteres).',
  /*
   * O identificador é o que vai na URL, e a F62 fará login por ele. Repetir
   * é erro de quem preencheu, então a API responde 409 com código próprio --
   * e a frase pode AFIRMAR a causa em vez de sugeri-la.
   */
  TENANT_SLUG_TAKEN: 'Já existe uma academia com este identificador.',
  JUSTIFICATIVA_OBRIGATORIA: 'Escreva a justificativa da entrada de suporte (ao menos 10 caracteres).',

  /*
   * Recusas do upload de marca (F62). Cada uma tem frase própria porque cada
   * uma pede uma AÇÃO diferente de quem cadastra: arquivo grande se comprime,
   * formato errado se converte, antivírus fora do ar se tenta de novo. Uma
   * frase genérica faria a pessoa reenviar o que nunca vai passar.
   */
  FILE_REQUIRED: 'Escolha um arquivo.',
  FILE_TOO_LARGE: 'O arquivo passa de 1 MB. Reduza o tamanho.',
  FILE_EMPTY: 'O arquivo está vazio.',
  FILE_TYPE_NOT_ALLOWED: 'Só entram SVG ou PNG.',
  FILE_SIGNATURE_MISMATCH: 'O conteúdo do arquivo não corresponde ao formato informado.',
  /*
   * A recusa do SVG com script DIZ O QUE FAZER. É a mensagem que mais importa
   * desta fatia: quem exportou o vetor do Illustrator ou do Figma não sabe que
   * ele saiu com script embutido, e "arquivo inválido" mandaria a pessoa
   * tentar de novo o mesmo arquivo.
   */
  SVG_UNSAFE_CONTENT:
    'Este SVG tem script embutido e foi recusado. Exporte o vetor sem script, ou envie um PNG.',
  FILE_INFECTED: 'O antivírus recusou este arquivo.',
  SCANNER_UNAVAILABLE: 'O antivírus está indisponível. Tente de novo em instantes.',
  SCANNER_TIMEOUT: 'O antivírus demorou a responder. Tente de novo em instantes.',
  BRANDING_PIECE_INVALID: 'Peça de identidade desconhecida.',
  /*
   * 409: a sessão já tem uma elevação viva. Não é erro de preenchimento --
   * quem vê isto precisa saber que já ESTÁ dentro de um tenant, e que sair de
   * lá é o passo que falta.
   */
  ELEVACAO_JA_ABERTA: 'Esta sessão já tem uma elevação aberta. Encerre-a antes de entrar em outra academia.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function criarTenant(
  _anterior: EstadoDoTenant,
  formulario: FormData,
): Promise<EstadoDoTenant> {
  const valores = {
    slug: texto(formulario, 'slug'),
    legalName: texto(formulario, 'legalName'),
    displayName: texto(formulario, 'displayName'),
    cnpj: texto(formulario, 'cnpj'),
    timezone: texto(formulario, 'timezone'),
    responsavelNome: texto(formulario, 'responsavelNome'),
    responsavelEmail: texto(formulario, 'responsavelEmail'),
    unidadeCode: texto(formulario, 'unidadeCode'),
    unidadeName: texto(formulario, 'unidadeName'),
  };

  const validado = esquemaDeTenant.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  const dados = validado.data;

  const resposta = await chamarApi<{ id: string; gymUnitId: string; emailEnviado: boolean }>(
    '/api/v1/platform/tenants',
    {
      metodo: 'POST',
      corpo: {
        slug: dados.slug,
        legalName: dados.legalName,
        displayName: dados.displayName,
        cnpj: dados.cnpj,
        timezone: dados.timezone,
        responsavelNome: dados.responsavelNome,
        responsavelEmail: dados.responsavelEmail,
        /*
         * A primeira unidade herda o fuso do tenant: pedir os dois separados
         * na mesma tela seria oferecer uma divergência que ninguém quer no
         * cadastro, e a unidade pode ser corrigida depois em `/units`.
         */
        unidade: {
          code: dados.unidadeCode,
          name: dados.unidadeName,
          timezone: dados.timezone,
        },
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível criar a academia'), valores };
  }

  revalidatePath('/platform');

  return {
    sucesso: {
      id: resposta.dados.id,
      displayName: dados.displayName,
      /*
       * O RESEND RESPONDE ERRO COM HTTP 200, e é por isso que a API devolve
       * este booleano em vez de deixar a falha sumir. Perdê-lo aqui faria a
       * tela afirmar um convite que não saiu, e o dono da academia esperaria
       * um e-mail que nunca chega.
       */
      emailEnviado: resposta.dados.emailEnviado,
    },
  };
}

/**
 * Edição dos dados da academia — F61.
 *
 * `slug` NÃO entra: ele é o identificador público e permanente (a F62 fará
 * login por ele), e a tela nem o oferece. `status` também não: alternar
 * operação é ato com motivo auditado, e misturá-lo aqui deixaria um "salvar"
 * de dados cadastrais desligar uma academia sem que ninguém escrevesse por quê.
 */
const esquemaDeEdicao = z.object({
  legalName: z
    .string()
    .trim()
    .min(1, 'Informe a razão social')
    .max(200, 'Razão social longa demais'),
  displayName: z.string().trim().min(1, 'Informe o nome fantasia').max(120, 'Nome longo demais'),
  cnpj: z
    .string()
    .trim()
    .transform((valor) => valor.replace(/\D/g, ''))
    .refine((valor) => valor.length === 14, 'CNPJ precisa ter 14 dígitos'),
  timezone: z.string().min(1, 'Selecione o fuso horário'),
  responsavelNome: z.string().trim().min(1, 'Informe o nome do responsável').max(120),
  responsavelEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail do responsável inválido')
    .max(320),
  /*
   * Missão e diferenciais (F62) — texto do hero da tela de login por slug.
   *
   * SEM `.min(1)`, ao contrário de todos os campos acima: string vazia é o
   * jeito de APAGAR o texto. Exigir conteúdo aqui deixaria quem escreveu a
   * missão por engano sem como removê-la.
   */
  missionText: z.string().trim().max(280, 'Missão longa demais (máximo 280 caracteres)'),
  highlightsText: z
    .string()
    .trim()
    .max(500, 'Diferenciais longos demais (máximo 500 caracteres)'),
});

/** O que a tela de edição devolve ao formulário quando erra. */
export interface ValoresDaEdicao {
  legalName: string;
  displayName: string;
  cnpj: string;
  timezone: string;
  responsavelNome: string;
  responsavelEmail: string;
  missionText: string;
  highlightsText: string;
}

export interface EstadoDaEdicao {
  erro?: string;
  salvo?: boolean;
  valores?: ValoresDaEdicao;
}

export async function alterarTenant(
  _anterior: EstadoDaEdicao,
  formulario: FormData,
): Promise<EstadoDaEdicao> {
  const tenantId = texto(formulario, 'tenantId');

  const valores = {
    legalName: texto(formulario, 'legalName'),
    displayName: texto(formulario, 'displayName'),
    cnpj: texto(formulario, 'cnpj'),
    timezone: texto(formulario, 'timezone'),
    responsavelNome: texto(formulario, 'responsavelNome'),
    responsavelEmail: texto(formulario, 'responsavelEmail'),
    missionText: texto(formulario, 'missionText'),
    highlightsText: texto(formulario, 'highlightsText'),
  };

  const validado = esquemaDeEdicao.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`,
    { metodo: 'PATCH', corpo: validado.data },
  );

  if (!resposta.ok) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar a academia'),
      valores,
    };
  }

  revalidatePath('/platform');
  revalidatePath(`/platform/${tenantId}`);

  return { salvo: true };
}

/**
 * Alternar operação da academia — ato com motivo auditado.
 *
 * `SUSPENDED` fica de fora: quem escreve suspensão é a inadimplência (F65),
 * nunca este CRUD. Aceitá-lo aqui deixaria o painel fabricar uma suspensão que
 * a cobrança não conhece — e que a cobrança não saberia levantar depois.
 */
const esquemaDeStatus = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE']),
    reason: z.string().trim(),
  })
  .refine((dados) => dados.status !== 'INACTIVE' || dados.reason.length >= 10, {
    message: 'Escreva o motivo da inativação (ao menos 10 caracteres).',
    path: ['reason'],
  });

export interface EstadoDoStatus {
  erro?: string;
  salvo?: boolean;
}

export async function alternarStatusDoTenant(
  _anterior: EstadoDoStatus,
  formulario: FormData,
): Promise<EstadoDoStatus> {
  const tenantId = texto(formulario, 'tenantId');

  const validado = esquemaDeStatus.safeParse({
    status: texto(formulario, 'status'),
    reason: texto(formulario, 'reason'),
  });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const { status, reason } = validado.data;

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}`,
    {
      metodo: 'PATCH',
      corpo: {
        status,
        /*
         * Motivo SÓ quando ele existe de verdade. Campo em branco na auditoria
         * é pior que campo ausente: parece que alguém respondeu e não
         * respondeu nada.
         */
        ...(status === 'INACTIVE' ? { reason } : {}),
      },
    },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível mudar a situação') };
  }

  revalidatePath('/platform');
  revalidatePath(`/platform/${tenantId}`);

  return { salvo: true };
}

const esquemaDeElevacao = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Escreva a justificativa da entrada de suporte (ao menos 10 caracteres).')
    .max(500, 'Justificativa longa demais'),
});

export interface EstadoDaElevacao {
  erro?: string;
}

/**
 * Entra na academia como suporte — F61.
 *
 * A API troca o COOKIE DE ACESSO por um token que carrega o tenant alvo: a
 * sessão é a mesma, o que muda é o alcance dela. Sem repassar esse cookie ao
 * navegador, a pessoa "eleva" e continua sem alcançar nada, e o sintoma parece
 * bug de permissão — longe da causa.
 *
 * Só repassa em SUCESSO. Numa recusa o token antigo continua valendo, e
 * escrever por cima com o que veio numa resposta de erro trocaria uma sessão
 * boa por uma indefinida.
 */
export async function elevarSuporte(
  _anterior: EstadoDaElevacao,
  formulario: FormData,
): Promise<EstadoDaElevacao> {
  const tenantId = texto(formulario, 'tenantId');

  const validado = esquemaDeElevacao.safeParse({ reason: texto(formulario, 'reason') });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira a justificativa.' };
  }

  const resposta = await chamarApi<{ id: string; expiresAt: string }>(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/elevar`,
    { metodo: 'POST', corpo: validado.data },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível entrar como suporte') };
  }

  /*
   * O cookie vem ANTES do `redirect`: o `redirect` lança para interromper o
   * render, e o que viesse depois dele nunca chegaria ao navegador.
   */
  await repassarCookies(resposta.cookiesDaApi);

  // `/dashboard` porque é onde o painel do tenant começa — é a mesma porta de
  // entrada do login, e a faixa de suporte acompanha a pessoa a partir dali.
  redirect('/dashboard');
}

/**
 * Sai da academia — o simétrico da entrada.
 *
 * A API devolve o cookie SEM tenant, e é ele que tira a pessoa de lá. Perdê-lo
 * deixaria alguém elevado depois de clicar em "Sair do suporte", que é pior
 * que não ter o botão: a tela afirmaria uma saída que não houve.
 *
 * Volta para `/platform` de qualquer jeito. Se a API recusou (elevação já
 * encerrada por prazo, por exemplo), o token com tenant expira sozinho e a
 * lista de academias é o lugar certo para reaparecer — travar a pessoa dentro
 * do tenant seria o pior dos dois desfechos.
 */
export async function encerrarSuporte(): Promise<void> {
  const resposta = await chamarApi<{ encerrada: boolean }>('/api/v1/platform/elevacao/encerrar', {
    metodo: 'POST',
  });

  if (resposta.ok) await repassarCookies(resposta.cookiesDaApi);

  redirect('/platform');
}


/**
 * Envia o logo ou o ícone da academia — F62 (ADR-052 §9).
 *
 * REVALIDA a página do tenant, ao contrário do upload de mídia do totem: lá o
 * upload devolve uma chave que o gerente ainda vai colocar num rascunho em
 * memória; aqui a API já gravou a coluna, e a tela precisa refletir isso na
 * hora — o "trocar logo" que continua dizendo "enviar logo" faz a pessoa
 * enviar duas vezes achando que a primeira falhou.
 *
 * O arquivo é repassado num `FormData` NOVO, e não o do formulário: o
 * formulário carrega junto o `tenantId` e a peça, que são campos nossos e não
 * têm por que chegar ao `FileInterceptor` da API.
 */
export interface EstadoDoUploadDeMarca {
  erro?: string;
  enviado?: boolean;
}

export async function enviarArquivoDeMarca(
  _anterior: EstadoDoUploadDeMarca,
  formulario: FormData,
): Promise<EstadoDoUploadDeMarca> {
  const tenantId = texto(formulario, 'tenantId');
  const peca = texto(formulario, 'peca');
  const arquivo = formulario.get('file');

  /*
   * `size === 0` cobre o campo de arquivo VAZIO, que o navegador manda como um
   * `File` de nome em branco em vez de omitir. Sem esta linha o `submit` sem
   * escolher arquivo viraria um POST que a API recusa com `FILE_EMPTY` —
   * mesma frase, uma ida e volta de rede a mais.
   */
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { erro: MENSAGEM['FILE_REQUIRED'] ?? 'Escolha um arquivo.' };
  }

  const envio = new FormData();
  envio.append('file', arquivo);

  const resposta = await chamarApi<{ objectKey: string }>(
    `/api/v1/platform/tenants/${encodeURIComponent(tenantId)}/branding/${encodeURIComponent(peca)}`,
    { metodo: 'POST', formulario: envio },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível enviar o arquivo') };
  }

  revalidatePath(`/platform/${tenantId}`);

  return { enviado: true };
}
