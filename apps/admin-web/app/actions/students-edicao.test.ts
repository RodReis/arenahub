import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { editarAluno } from './students';

const ALUNO = '11111111-1111-4111-8111-111111111111';

/**
 * O formulário de edição manda TODOS os campos, sempre -- ele mantém as três
 * abas montadas e esconde por CSS. Campo que a tela não mostra chega como
 * string VAZIA, não ausente: é `texto()` sobre a lista fechada
 * `CAMPOS_DA_EDICAO`, e essa distinção é a origem do defeito que estes testes
 * pegam.
 */
function formulario(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('studentId', ALUNO);
  dados.set('version', '3');
  dados.set('fullName', 'Joao Pedro Ramalho');
  dados.set('birthDate', '1992-02-11');

  // Os demais campos da lista fechada, vazios -- como a tela os manda.
  for (const campo of [
    'cpf',
    'rg',
    'registeredSex',
    'telefone',
    'whatsapp',
    'email',
    'cep',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'cidade',
    'uf',
    'emergenciaNome',
    'emergenciaParentesco',
    'emergenciaTelefone',
    'statusReason',
    'statusReasonNote',
  ]) {
    dados.set(campo, '');
  }

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function salvo() {
  return { ok: true, dados: { version: 4 }, cookiesDaApi: [] };
}

/** O corpo que a action REALMENTE enviou -- é o que estes testes afirmam. */
function corpoEnviado(): Record<string, unknown> {
  return vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
}

describe('editarAluno -- motivo da situação', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  /**
   * O DEFEITO QUE ESTE TESTE EXISTE PARA PEGAR (issue #241).
   *
   * O campo aparecia na tela, entrava no FormData e a action respondia
   * "Cadastro atualizado" -- mas o corpo saía SEM `statusReason`, e o banco
   * ficava sem motivo. Três verificações no navegador não localizaram o elo;
   * um teste sobre a action isola em segundos, porque afirma o CORPO ENVIADO
   * e não o efeito na tela.
   */
  it('envia o motivo escolhido no corpo do PATCH', async () => {
    vi.mocked(chamarApi).mockResolvedValue(salvo());

    const estado = await editarAluno(
      {},
      formulario({ statusReason: 'CONDUCT', statusReasonNote: 'emprestou a credencial' }),
    );

    expect(estado.erro).toBeUndefined();
    expect(corpoEnviado()['statusReason']).toBe('CONDUCT');
    expect(corpoEnviado()['statusReasonNote']).toBe('emprestou a credencial');
  });

  /**
   * ALUNO ATIVO NÃO PODE QUEBRAR.
   *
   * Para ele os campos de motivo nem existem no DOM, então chegam vazios --
   * e a API é `.strict()` com `CHECK` no banco: mandar `''` ou `null` ali
   * seria recusado. Ausente é a única forma correta de dizer "não mexer".
   */
  it('omite o motivo quando o campo veio vazio', async () => {
    vi.mocked(chamarApi).mockResolvedValue(salvo());

    const estado = await editarAluno({}, formulario());

    expect(estado.erro).toBeUndefined();
    expect(corpoEnviado()).not.toHaveProperty('statusReason');
    expect(corpoEnviado()).not.toHaveProperty('statusReasonNote');
  });

  /**
   * O CAMPO VAZIO NÃO PODE VIRAR ERRO DE VALIDAÇÃO.
   *
   * `z.enum().optional()` admite a chave AUSENTE, não a string vazia -- e a
   * tela sempre manda a chave. Sem tratar o `''`, editar o telefone de
   * qualquer aluno ativo falharia com "Selecione o motivo na lista", num
   * campo que a tela nem mostra.
   */
  it('não recusa a edição de aluno ativo por causa do motivo vazio', async () => {
    vi.mocked(chamarApi).mockResolvedValue(salvo());

    const estado = await editarAluno({}, formulario({ telefone: '41999990000' }));

    expect(estado.erro).toBeUndefined();
    expect(vi.mocked(chamarApi)).toHaveBeenCalled();
  });

  /**
   * MOTIVO SEM OBSERVAÇÃO É VÁLIDO -- a observação é opcional, e o `null`
   * explícito é como este schema apaga campo.
   */
  it('envia motivo sem observação, com a observação nula', async () => {
    vi.mocked(chamarApi).mockResolvedValue(salvo());

    await editarAluno({}, formulario({ statusReason: 'MEDICAL' }));

    expect(corpoEnviado()['statusReason']).toBe('MEDICAL');
    expect(corpoEnviado()['statusReasonNote']).toBeNull();
  });

  /**
   * O CPF NÃO PODE TRAVAR A EDIÇÃO de quem nunca teve um -- 322 alunos hoje
   * (seed e importados do Pacto). Ele sai do corpo em vez de virar `''`, que
   * a API recusaria como CPF inválido.
   */
  it('omite o CPF vazio em vez de mandá-lo como string vazia', async () => {
    vi.mocked(chamarApi).mockResolvedValue(salvo());

    const estado = await editarAluno({}, formulario());

    expect(estado.erro).toBeUndefined();
    expect(corpoEnviado()).not.toHaveProperty('cpf');
  });

  /**
   * SEXO CADASTRAL "Não informado" é `''` na tela -- e derrubava o
   * formulário com a mensagem CRUA do Zod em inglês
   * (`Invalid option: expected one of "FEMALE"|"MALE"|"NOT_INFORMED"`), que
   * o CLAUDE.md proíbe mostrar à recepção.
   */
  it('aceita sexo cadastral vazio sem vazar mensagem do Zod', async () => {
    vi.mocked(chamarApi).mockResolvedValue(salvo());

    const estado = await editarAluno({}, formulario({ registeredSex: '' }));

    expect(estado.erro).toBeUndefined();
    expect(corpoEnviado()['registeredSex']).toBeNull();
  });
});
