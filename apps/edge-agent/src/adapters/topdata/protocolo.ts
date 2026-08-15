import { z } from 'zod';

/**
 * Mensagens do protocolo WebSocket do leitor facial Topdata.
 *
 * Cada schema aqui corresponde a um comando ou retorno documentado em
 * `docs/vendor/topdata/PROTOCOLO-FACIAL.md`, que por sua vez resume o
 * "Manual de Comandos do Leitor Facial" Rev. 03 e o "Manual SDK Leitor de
 * Biometria Facial" Rev. 05.
 *
 * TUDO QUE CHEGA DO EQUIPAMENTO PASSA POR ZOD. O leitor e software de
 * terceiro numa rede que nao controlamos -- `unknown` antes de validar
 * (CLAUDE.md -> Convencoes). Confiar no formato porque "o manual diz" e
 * como confiar em corpo de requisicao HTTP.
 */

/**
 * Discriminador de tipo de dado. Muda o significado de `record` em quase
 * todo comando.
 */
export const BACKUPNUM = {
  /** Usuario sem foto: nome, admin, cartao, senha. `record` deve ser "0". */
  SEM_FOTO: 0,
  SENHA: 10,
  CARTAO: 11,
  /** Todos, exceto biometria. */
  TODOS_MENOS_BIOMETRIA: 13,
  /** Foto -- `record` e a imagem em Base64. */
  FOTO: 50,
} as const;

/** `enrollid` que o equipamento usa para "rosto desconhecido". */
export const ENROLL_ID_DESCONHECIDO = 99_999_999;

/** Modo de autenticacao no `sendlog`. */
export const MODO_FACIAL = 1;

/** Tipo de evento no `sendlog`. */
export const EVENTO = {
  AUTENTICACAO: 0,
  DESCONHECIDO: 2,
} as const;

// --- o que o equipamento ENVIA --------------------------------------------

/**
 * `reg` -- handshake. O leitor manda ao conectar.
 *
 * `devinfo` e validado com `passthrough` porque o manual mostra campos
 * diferentes em cada revisao (`facesize` aparece num, nao no outro). Exigir
 * a lista fechada quebraria com firmware novo, e nada aqui e critico o
 * bastante para justificar isso.
 */
export const esquemaReg = z.object({
  cmd: z.literal('reg'),
  sn: z.string().min(1),
  devinfo: z
    .object({
      modelname: z.string().optional(),
      firmware: z.string().optional(),
      time: z.string().optional(),
      usersize: z.number().optional(),
      useduser: z.number().optional(),
    })
    .loose(),
});

/** Um registro dentro de `sendlog`. */
export const esquemaRegistroLog = z.object({
  enrollid: z.number().int(),
  name: z.string().optional(),
  /** "2023-12-27 10:00:00" -- horario DO EQUIPAMENTO, nao nosso. */
  time: z.string(),
  mode: z.number().int().optional(),
  /** 0 = entrada. */
  inout: z.number().int().optional(),
  event: z.number().int().optional(),
  /**
   * Foto em Base64. NAO deve chegar: `setdevinfo` desliga o envio.
   *
   * O schema aceita para nao derrubar a conexao se o equipamento mandar
   * mesmo assim -- mas quem trata DESCARTA. Ver o adapter.
   */
  image: z.string().optional(),
});

export const esquemaSendLog = z.object({
  cmd: z.literal('sendlog'),
  sn: z.string().min(1),
  count: z.number().int().optional(),
  logindex: z.number().int().optional(),
  record: z.array(esquemaRegistroLog),
});

/** Retorno generico: todo `ret` tem pelo menos isto. */
export const esquemaRetorno = z
  .object({
    ret: z.string().min(1),
    sn: z.string().optional(),
    result: z.boolean().optional(),
    reason: z.number().optional(),
    msg: z.string().optional(),
  })
  .loose();

export const esquemaRetGetUserList = esquemaRetorno.extend({
  ret: z.literal('getuserlist'),
  count: z.number().int().optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  record: z
    .array(
      z.object({
        enrollid: z.number().int(),
        admin: z.union([z.string(), z.number()]).optional(),
        backupnum: z.number().int().optional(),
      }),
    )
    .optional(),
});

/** Qualquer mensagem vinda do equipamento. */
export const esquemaMensagemDoEquipamento = z.union([
  esquemaReg,
  esquemaSendLog,
  esquemaRetorno,
]);

export type Reg = z.infer<typeof esquemaReg>;
export type SendLog = z.infer<typeof esquemaSendLog>;
export type Retorno = z.infer<typeof esquemaRetorno>;
export type RetGetUserList = z.infer<typeof esquemaRetGetUserList>;

// --- o que NOS enviamos ---------------------------------------------------

/**
 * Resposta ao `reg`. OBRIGATORIA.
 *
 * O manual: "Caso a resposta nao seja enviada, a comunicacao com o leitor
 * facial sera perdida". Nao e recomendacao.
 */
export function respostaReg(agora: Date): string {
  return JSON.stringify({
    ret: 'reg',
    result: true,
    cloudtime: formatarDataHora(agora),
  });
}

/**
 * "YYYY-MM-DD HH:mm:ss" -- o formato que o equipamento espera no
 * `cloudtime`. ISO com T e Z nao serve.
 *
 * Usa a hora LOCAL de proposito: o leitor exibe e registra no fuso da
 * unidade, e mandar UTC deixaria o relogio dele adiantado tres horas.
 */
export function formatarDataHora(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export const comandos = {
  disableDevice: (): string => JSON.stringify({ cmd: 'disabledevice' }),
  enableDevice: (): string => JSON.stringify({ cmd: 'enabledevice' }),

  /**
   * Cadastra ou atualiza SEM foto.
   *
   * `record: "0"` nao e detalhe: o manual manda o valor literal `"0"` para
   * indicar que nao ha dado especifico.
   */
  setUserInfoSemFoto: (p: {
    enrollid: number;
    name: string;
    admin?: number;
  }): string =>
    JSON.stringify({
      cmd: 'setuserinfo',
      enrollid: p.enrollid,
      name: p.name,
      backupnum: BACKUPNUM.SEM_FOTO,
      admin: p.admin ?? 0,
      enable: 1,
      record: '0',
    }),

  setUserInfoComFoto: (p: {
    enrollid: number;
    name: string;
    fotoBase64: string;
    admin?: number;
  }): string =>
    JSON.stringify({
      cmd: 'setuserinfo',
      enrollid: p.enrollid,
      name: p.name,
      backupnum: BACKUPNUM.FOTO,
      admin: p.admin ?? 0,
      enable: 1,
      record: p.fotoBase64,
    }),

  /** Remove TODOS os dados do usuario -- `backupnum: 13`. */
  deleteUser: (enrollid: number): string =>
    JSON.stringify({
      cmd: 'deleteuser',
      enrollid,
      backupnum: BACKUPNUM.TODOS_MENOS_BIOMETRIA,
    }),

  /** Remove so a biometria, mantendo o cadastro. */
  deleteBiometria: (enrollid: number): string =>
    JSON.stringify({ cmd: 'deleteuser', enrollid, backupnum: BACKUPNUM.FOTO }),

  getUserList: (primeiraPagina: boolean): string =>
    JSON.stringify({ cmd: 'getuserlist', stn: primeiraPagina }),

  getUserInfo: (enrollid: number, backupnum: number): string =>
    JSON.stringify({ cmd: 'getuserinfo', enrollid, backupnum }),

  /**
   * Desliga o envio de foto pelo equipamento.
   *
   * `use_logphoto: 0` e `stranger_photo: 0` sao a POSTURA PADRAO, nao uma
   * opcao. Receber foto de quem passou -- e principalmente de quem NAO esta
   * cadastrado, que e o `stranger_photo` -- e tratamento de dado biometrico
   * sem base legal (regra de arquitetura no 7, ADR-008). Ligar exige decisao
   * do PI, nao conveniencia de implementacao.
   */
  desligarEnvioDeFoto: (): string =>
    JSON.stringify({ cmd: 'setdevinfo', use_logphoto: 0, stranger_photo: 0 }),
} as const;
