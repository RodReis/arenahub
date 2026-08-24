'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from './edicao.module.css';

import { editarAluno, type EstadoDaEdicao } from '../../../actions/students';

/** Contato como a API o devolve. */
interface Contato {
  type: string;
  value: string;
  isPrimary: boolean;
  label: string | null;
  relationship: string | null;
}

interface Endereco {
  postalCode: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
}

interface Props {
  readonly studentId: string;
  readonly nomeDoAluno: string;
  readonly version: number;
  readonly fullName: string;
  readonly birthDate: string;
  readonly cpf: string | null;
  readonly rg: string | null;
  readonly registeredSex: string | null;
  readonly contacts: readonly Contato[];
  readonly address: Endereco | null;
}

const ESTADO_INICIAL: EstadoDaEdicao = {};

const ABAS = [
  { id: 'identificacao', rotulo: 'Identificação' },
  { id: 'contato', rotulo: 'Contato' },
  { id: 'endereco', rotulo: 'Endereço' },
] as const;

type IdDeAba = (typeof ABAS)[number]['id'];

/**
 * Primeiro contato de um tipo, ou string vazia.
 *
 * A API guarda uma LISTA e esta tela edita um campo por tipo. Ver
 * `contatosSimplesDemais`: quando há repetido, a edição de contato sai de
 * cena em vez de apagar o que não cabe.
 */
function primeiroContato(contatos: readonly Contato[], tipo: string): string {
  return contatos.find((contato) => contato.type === tipo)?.value ?? '';
}

function contatoDeEmergencia(contatos: readonly Contato[]): Contato | undefined {
  return contatos.find((contato) => contato.type === 'EMERGENCY');
}

/**
 * A ficha só pode reeditar contatos que ela consegue REPRESENTAR.
 *
 * `contacts` substitui a lista inteira no PATCH. Um aluno com dois telefones
 * tem o segundo invisível aqui — e salvar o apagaria em silêncio, que é o
 * tipo de perda que ninguém percebe até precisar ligar.
 */
function contatosSimplesDemais(contatos: readonly Contato[]): boolean {
  const porTipo = new Map<string, number>();

  for (const contato of contatos) {
    porTipo.set(contato.type, (porTipo.get(contato.type) ?? 0) + 1);
  }

  return [...porTipo.values()].every((quantidade) => quantidade <= 1);
}

function BotaoDeEdicao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-edicao">
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

/**
 * Edição do cadastro — modal com abas.
 *
 * A primeira versão era um formulário inline de dezoito campos empilhados, e
 * o PI reprovou: empurrava "Acesso agora" e "Direitos de acesso" para baixo
 * da dobra numa tela que existe para CONSULTAR. Editar cadastro é tarefa
 * pontual, com começo e fim — o caso em que modal é a resposta certa, e não
 * preguiça de resolver o layout.
 *
 * `<dialog>` NATIVO: foco preso, `Esc` para fechar, backdrop e top layer de
 * graça. Reimplementar isso à mão é como se perde acessibilidade sem
 * perceber.
 *
 * TODOS OS CAMPOS FICAM MONTADOS, sempre. As abas escondem por CSS, não
 * desmontam — um `<input>` desmontado não entra no `FormData`, e salvar da
 * aba "Contato" apagaria endereço e identificação. É o mesmo motivo pelo
 * qual o wizard de cadastro não usa `required` nativo em passo escondido.
 */
export function EditarCadastro({
  studentId,
  nomeDoAluno,
  version,
  fullName,
  birthDate,
  cpf,
  rg,
  registeredSex,
  contacts,
  address,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [aba, setAba] = useState<IdDeAba>('identificacao');
  const [estado, acao] = useActionState(editarAluno, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', `erro-da-edicao-${studentId}`);
  /*
   * SUCESSO TAMBEM AVISA. O modal fecha sozinho ao salvar, e sem o toast a
   * recepcao ficava sem nenhuma confirmacao -- a tela simplesmente voltava
   * ao normal, indistinguivel de um "Cancelar". Mesmo par do botao de
   * liberar catraca: `error` para a falha, `info` para o feito.
   *
   * `info` e nao `success` porque o Toast do painel tem tres canais --
   * info, warn, error (CLAUDE.md, Convencoes de codigo). Nao ha um quarto.
   */
  useToastDeErro(
    estado.sucesso ? 'Cadastro atualizado.' : undefined,
    'info',
    `sucesso-da-edicao-${studentId}`,
  );

  /*
   * `showModal()` é o que traz foco preso e backdrop -- o atributo `open` no
   * JSX abriria o dialog SEM nada disso, como um `<div>` qualquer.
   */
  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  /*
   * Fechou pelo `Esc` ou pelo backdrop: o navegador dispara `close` sem
   * passar pelo nosso botão, e sem isto o estado ficaria dizendo "aberto"
   * com o dialog fechado -- e o próximo clique no botão não abriria nada.
   */
  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    const aoFechar = (): void => setAberto(false);
    elemento.addEventListener('close', aoFechar);

    return () => elemento.removeEventListener('close', aoFechar);
  }, []);

  // Salvou: fecha sozinho. A ficha por trás já foi revalidada pela action.
  useEffect(() => {
    if (estado.sucesso) setAberto(false);
  }, [estado.sucesso]);

  const versaoVigente = estado.sucesso?.version ?? version;
  const podeEditarContatos = contatosSimplesDemais(contacts);
  const emergencia = contatoDeEmergencia(contacts);

  /**
   * O que o campo mostra: o que a recepção digitou (quando o salvamento
   * falhou) ou o que veio da API. Nunca vazio por erro — a regra de
   * acessibilidade do painel é explícita: formulário nunca limpa dado em
   * erro recuperável.
   */
  const valor = (campo: string, daApi: string): string => estado.valores?.[campo] ?? daApi;

  const painel = (id: IdDeAba): { hidden: boolean; role: string; id: string } => ({
    hidden: aba !== id,
    role: 'tabpanel',
    id: `painel-${id}-${studentId}`,
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`abrir-edicao-${studentId}`}
      >
        Editar cadastro
      </Button>

      <dialog ref={dialogo} className={estilos['dialogo']} aria-labelledby={`titulo-edicao-${studentId}`}>
        <form className={estilos['moldura']} action={acao}>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="version" value={versaoVigente} />

          <div className={estilos['cabecalho']}>
            <div>
              <h2 className={estilos['titulo']} id={`titulo-edicao-${studentId}`}>
                Editar cadastro
              </h2>
              {/* De QUEM é a ficha: o modal cobre a tela que dizia isso. */}
              <p className={estilos['subtitulo']}>{nomeDoAluno}</p>
            </div>
          </div>

          {/*
            `role="tablist"` de verdade: dezoito campos em três grupos só
            ajudam se der para circular sem o mouse -- a recepção opera de
            pé, com o aluno esperando.
          */}
          <div className={estilos['abas']} role="tablist" aria-label="Seções do cadastro">
            {ABAS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`aba-${item.id}-${studentId}`}
                aria-selected={aba === item.id}
                aria-controls={`painel-${item.id}-${studentId}`}
                className={`${estilos['aba']} ${aba === item.id ? estilos['abaAtiva'] : ''}`}
                onClick={() => setAba(item.id)}
                data-testid={`aba-${item.id}`}
              >
                {item.rotulo}
              </button>
            ))}
          </div>

          <div className={estilos['corpo']}>
            <div {...painel('identificacao')} aria-labelledby={`aba-identificacao-${studentId}`}>
              <div className={estilos['grade']}>
                <div className={estilos['largo']}>
                  <Field
                    id={`edicao-nome-${studentId}`}
                    name="fullName"
                    label="Nome completo"
                    defaultValue={valor('fullName', fullName)}
                    maxLength={160}
                    required
                    data-testid="campo-edicao-nome"
                  />
                </div>

                <Field
                  id={`edicao-nascimento-${studentId}`}
                  name="birthDate"
                  type="date"
                  label="Data de nascimento"
                  /*
                    A API devolve `YYYY-MM-DD` puro -- `birthDate` é `@db.Date`
                    e o controller já corta o instante. O `slice` fica como
                    guarda de formato, não como conversão.
                  */
                  defaultValue={valor('birthDate', birthDate.slice(0, 10))}
                  required
                  data-testid="campo-edicao-nascimento"
                />

                <Field
                  id={`edicao-cpf-${studentId}`}
                  name="cpf"
                  label="CPF"
                  defaultValue={valor('cpf', cpf ?? '')}
                  required
                  data-testid="campo-edicao-cpf"
                />

                <Field
                  id={`edicao-rg-${studentId}`}
                  name="rg"
                  label="RG"
                  defaultValue={valor('rg', rg ?? '')}
                  maxLength={40}
                  data-testid="campo-edicao-rg"
                />

                <SelectField
                  id={`edicao-sexo-${studentId}`}
                  name="registeredSex"
                  label="Sexo cadastral"
                  defaultValue={valor('registeredSex', registeredSex ?? '')}
                  data-testid="campo-edicao-sexo"
                >
                  <option value="">Não informado</option>
                  <option value="FEMALE">Feminino</option>
                  <option value="MALE">Masculino</option>
                  <option value="NOT_INFORMED">Prefere não informar</option>
                </SelectField>

                <p className={estilos['nota']}>
                  O CPF é obrigatório — o antifraude da cobrança por cartão recusa sem ele.
                </p>
              </div>
            </div>

            <div {...painel('contato')} aria-labelledby={`aba-contato-${studentId}`}>
              {podeEditarContatos ? (
                <div className={estilos['grade']}>
                  <Field
                    id={`edicao-telefone-${studentId}`}
                    name="telefone"
                    label="Telefone"
                    defaultValue={valor('telefone', primeiroContato(contacts, 'PHONE'))}
                    maxLength={160}
                    data-testid="campo-edicao-telefone"
                  />

                  <Field
                    id={`edicao-whatsapp-${studentId}`}
                    name="whatsapp"
                    label="WhatsApp"
                    defaultValue={valor('whatsapp', primeiroContato(contacts, 'WHATSAPP'))}
                    maxLength={160}
                    data-testid="campo-edicao-whatsapp"
                  />

                  <div className={estilos['largo']}>
                    <Field
                      id={`edicao-email-${studentId}`}
                      name="email"
                      type="email"
                      label="E-mail"
                      defaultValue={valor('email', primeiroContato(contacts, 'EMAIL'))}
                      maxLength={160}
                      data-testid="campo-edicao-email"
                    />
                  </div>

                  <Field
                    id={`edicao-emergencia-nome-${studentId}`}
                    name="emergenciaNome"
                    label="Emergência — nome"
                    defaultValue={valor('emergenciaNome', emergencia?.label ?? '')}
                    maxLength={160}
                    data-testid="campo-edicao-emergencia-nome"
                  />

                  <Field
                    id={`edicao-emergencia-parentesco-${studentId}`}
                    name="emergenciaParentesco"
                    label="Parentesco"
                    defaultValue={valor('emergenciaParentesco', emergencia?.relationship ?? '')}
                    maxLength={80}
                    data-testid="campo-edicao-emergencia-parentesco"
                  />

                  <Field
                    id={`edicao-emergencia-telefone-${studentId}`}
                    name="emergenciaTelefone"
                    label="Emergência — telefone"
                    defaultValue={valor('emergenciaTelefone', emergencia?.value ?? '')}
                    maxLength={160}
                    data-testid="campo-edicao-emergencia-telefone"
                  />
                </div>
              ) : (
                /*
                  Ausência é a informação certa, como no botão de liberar
                  catraca: um formulário que apagaria o segundo telefone é
                  pior que nenhum.
                */
                <p role="note" data-testid="contatos-nao-editaveis">
                  Este aluno tem mais de um contato do mesmo tipo, e esta ficha edita um por tipo.
                  Salvar aqui apagaria os demais, então a edição de contatos está indisponível para
                  ele.
                </p>
              )}
            </div>

            <div {...painel('endereco')} aria-labelledby={`aba-endereco-${studentId}`}>
              <div className={estilos['grade']}>
                <Field
                  id={`edicao-cep-${studentId}`}
                  name="cep"
                  label="CEP"
                  defaultValue={valor('cep', address?.postalCode ?? '')}
                  data-testid="campo-edicao-cep"
                />

                <Field
                  id={`edicao-bairro-${studentId}`}
                  name="bairro"
                  label="Bairro"
                  defaultValue={valor('bairro', address?.district ?? '')}
                  maxLength={120}
                  data-testid="campo-edicao-bairro"
                />

                <div className={estilos['largo']}>
                  <Field
                    id={`edicao-logradouro-${studentId}`}
                    name="logradouro"
                    label="Logradouro"
                    defaultValue={valor('logradouro', address?.street ?? '')}
                    maxLength={200}
                    data-testid="campo-edicao-logradouro"
                  />
                </div>

                <Field
                  id={`edicao-numero-${studentId}`}
                  name="numero"
                  label="Número"
                  defaultValue={valor('numero', address?.number ?? '')}
                  maxLength={20}
                  data-testid="campo-edicao-numero"
                />

                <Field
                  id={`edicao-complemento-${studentId}`}
                  name="complemento"
                  label="Complemento"
                  defaultValue={valor('complemento', address?.complement ?? '')}
                  maxLength={120}
                  data-testid="campo-edicao-complemento"
                />

                <Field
                  id={`edicao-cidade-${studentId}`}
                  name="cidade"
                  label="Cidade"
                  defaultValue={valor('cidade', address?.city ?? '')}
                  maxLength={120}
                  data-testid="campo-edicao-cidade"
                />

                <Field
                  id={`edicao-uf-${studentId}`}
                  name="uf"
                  label="UF"
                  defaultValue={valor('uf', address?.state ?? '')}
                  maxLength={2}
                  data-testid="campo-edicao-uf"
                />

                {/*
                  O endereço é tudo-ou-nada na API: CEP, logradouro, cidade e
                  UF viajam juntos ou não viajam. O aviso evita o 400 que
                  diria "CEP inválido" para quem só preencheu a rua.
                */}
                <p className={estilos['nota']}>
                  Para gravar o endereço, preencha ao menos CEP, logradouro, cidade e UF.
                </p>
              </div>
            </div>
          </div>

          <div className={estilos['rodape']}>
            <p className={estilos['avisoDoRodape']}>
              Salvar grava as três seções, não só a aba aberta.
            </p>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoDeEdicao />
          </div>
        </form>
      </dialog>
    </>
  );
}
