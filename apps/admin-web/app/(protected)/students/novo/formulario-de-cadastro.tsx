'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToastDeErro } from '@arenahub/ui';

import { mascararCep, mascararCpf, mascararTelefone } from '@/lib/mascaras';

import { estadoDoPasso as calcularEstadoDoPasso } from '../../../../src/students/trilha';

import { cadastrarAluno, type EstadoDoCadastro } from '../../../actions/students';
import estilos from './wizard.module.css';

const ESTADO_INICIAL: EstadoDoCadastro = {};

const MOTIVO_DA_DUPLICATA: Record<string, string> = {
  CPF: 'mesmo CPF',
  EMAIL: 'mesmo e-mail',
  PHONE: 'mesmo telefone',
  NAME_AND_BIRTH_DATE: 'mesmo nome e data de nascimento',
};

const PASSOS = [
  'Dados pessoais',
  'Endereço e emergência',
  'Administrativo',
  'Plano e consentimentos',
] as const;

const ORIGENS_DO_LEAD = [
  ['INDICACAO', 'Indicação'],
  ['REDES_SOCIAIS', 'Redes sociais'],
  ['PASSAGEM_NA_PORTA', 'Passagem na porta'],
  ['CAMPANHA', 'Campanha'],
  ['SITE', 'Site'],
  ['OUTRO', 'Outro'],
] as const;

const SEXO_CADASTRAL = [
  ['FEMALE', 'Feminino'],
  ['MALE', 'Masculino'],
  ['NOT_INFORMED', 'Não informado'],
] as const;

const SITUACAO_INICIAL = [
  ['LEAD', 'Lead'],
  ['TRIAL', 'Experimental'],
  ['ACTIVE', 'Ativo'],
] as const;

/** As 27 UFs. Lista fechada — "XX" passaria por qualquer campo de texto. */
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

/**
 * Os tres campos obrigatorios, e em que passo cada um mora.
 *
 * ESTA LISTA EXISTE PORQUE O `required` DO HTML NAO FUNCIONA AQUI. Campo
 * dentro de um contêiner `hidden` fica FORA da validacao nativa do
 * navegador -- medido: com o formulario inteiro vazio, indo direto ao passo
 * 4, `form.checkValidity()` devolve `true` e nenhum campo aparece como
 * invalido. Sem esta checagem em JS, o clique em "Cadastrar aluno" envia um
 * formulario vazio e a pessoa fica olhando para um botao que nao faz nada.
 *
 * O passo entra junto do campo porque a mensagem sozinha nao resolve: dizer
 * "informe a unidade" a quem esta no passo 4 manda procurar em vinte e dois
 * campos espalhados por quatro telas.
 */
const OBRIGATORIOS = [
  { campo: 'fullName', passo: 0, rotulo: 'o nome completo' },
  { campo: 'birthDate', passo: 0, rotulo: 'a data de nascimento' },
  // CPF entrou na lista pelo ADR-043 Decisao 3: o antifraude do checkout de
  // cartao bloqueia cobranca sem CPF, e o PI decidiu exigi-lo no cadastro em
  // vez de dentro do fluxo de pagamento.
  { campo: 'cpf', passo: 0, rotulo: 'o CPF' },
  { campo: 'gymUnitId', passo: 2, rotulo: 'a unidade' },
] as const;

interface Unidade {
  id: string;
  code: string;
  name: string;
}

/** Rascunho do formulário: nome do campo -> o que foi digitado. */
type Rascunho = Record<string, string>;

interface PropsDeCampo {
  id: string;
  rotulo: string;
  /** "obrigatório" ou "opcional" — a marca ao lado do rótulo, como no mockup. */
  marca?: string;
  dica?: string;
  larguraTotal?: boolean;
  children: React.ReactNode;
}

/**
 * Rótulo, controle e dica.
 *
 * O `<label>` é de verdade e aponta para o `id` do controle: sem ele o leitor
 * de tela anuncia "caixa de edição" e a recepção descobre o campo pela
 * posição.
 */
function Campo({ id, rotulo, marca, dica, larguraTotal, children }: PropsDeCampo) {
  return (
    <div className={`${estilos['campo']} ${larguraTotal ? estilos['larguraTotal'] : ''}`}>
      <label className={estilos['rotulo']} htmlFor={id}>
        {rotulo}
        {marca ? <span className={estilos['marca']}>{marca}</span> : null}
      </label>

      {children}

      {dica ? (
        <p className={estilos['dica']} id={`${id}-dica`}>
          {dica}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Botão de envio que sabe quando está enviando.
 *
 * O cadastro não tem chave de idempotência no servidor: o segundo clique
 * criaria um segundo aluno com outra matrícula, e desfazer isso é trabalho
 * manual na recepção.
 */
function BotaoDeEnvio() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-cadastro">
      {pending ? 'Cadastrando…' : 'Cadastrar aluno'}
    </Button>
  );
}

/**
 * Cadastro completo de aluno em quatro passos — F45.
 *
 * NOME, NASCIMENTO, CPF E UNIDADE SÃO OS OBRIGATÓRIOS. O PI decidiu em 18/08
 * que o CPF ficava de fora; o ADR-043 Decisão 3 (23/08) REVERTE isso — o
 * antifraude do checkout de cartão bloqueia cobrança sem CPF, e exigi-lo no
 * cadastro evita pedir o documento dentro do fluxo de pagamento. A matrícula
 * continua sem depender do CPF (INV-009/011): o campo é obrigatório na
 * ENTRADA, nunca virou identificador. Telefone e e-mail continuam opcionais.
 *
 * UM FORMULÁRIO SÓ, QUATRO PASSOS VISÍVEIS. Os campos dos passos que não
 * estão na tela continuam montados, escondidos por `hidden` — e não
 * desmontados: React que desmonta um `<input>` descarta o valor, e a recepção
 * que voltasse ao passo 1 para conferir o nome perderia o endereço inteiro.
 * É o mesmo motivo de o envio ser um `<form action>` único no fim: enviar por
 * passo exigiria rascunho no servidor, que a fatia não pede.
 */
export function FormularioDeCadastro({ unidades }: { unidades: Unidade[] }) {
  const [estado, acao] = useActionState(cadastrarAluno, ESTADO_INICIAL);
  const [passo, setPasso] = useState(0);

  // O rascunho nasce do que a action devolveu: erro de validação no passo 3
  // não pode apagar o que foi digitado no passo 1.
  const [rascunho, setRascunho] = useState<Rascunho>(estado.valores ?? {});

  /**
   * Erro de campo obrigatorio, detectado no cliente.
   *
   * Separado de `estado.erro` (que vem do servidor) porque os dois tem vida
   * diferente: este some assim que a pessoa preenche o campo; aquele so
   * muda quando o formulario e reenviado.
   */
  const [faltando, setFaltando] = useState<string | null>(null);

  /*
   * Os dois erros da tela viram TOAST -- CLAUDE.md: "sempre usar Toast para:
   * Info, Warn e error".
   *
   * SAO DOIS `useToastDeErro`, e nao um `faltando ?? estado.erro`: os dois
   * tem vida propria, e coalescer faria o erro do servidor sumir do aviso
   * enquanto um campo obrigatorio estivesse pendente.
   */
  useToastDeErro(estado.erro, 'error', 'erro-do-cadastro');
  useToastDeErro(faltando, 'warn', 'erro-do-cadastro');

  const valor = (campo: string): string => rascunho[campo] ?? '';

  const anotar = (campo: string, novo: string): void => {
    setRascunho((atual) => ({ ...atual, [campo]: novo }));
  };

  /**
   * Campo de texto controlado, com máscara opcional.
   *
   * A máscara roda na digitação, não no envio: CPF que só se formata ao sair
   * do campo deixa a recepção sem saber se digitou onze dígitos.
   */
  const entrada = (
    campo: string,
    extras: {
      tipo?: string;
      mascara?: (valor: string) => string;
      maxLength?: number;
      placeholder?: string;
      obrigatorio?: boolean;
      inputMode?: 'numeric' | 'email' | 'tel';
      dica?: boolean;
    } = {},
  ) => (
    <input
      className={estilos['controle']}
      id={campo}
      name={campo}
      type={extras.tipo ?? 'text'}
      value={valor(campo)}
      // SEM `required` NATIVO, e o motivo e observado, nao teorico: campo
      // obrigatorio dentro de um contêiner `hidden` faz o navegador barrar o
      // envio, tentar focar o campo para apontar o erro, falhar porque ele
      // esta escondido, e desistir em silencio -- console diz "An invalid
      // form control with name='fullName' is not focusable", nenhum POST
      // sai e a tela nao muda. Quem valida e `faltaObrigatorio`, que ainda
      // leva a pessoa ao passo onde o campo mora.
      // `aria-required` fica: a informacao continua chegando ao leitor de
      // tela, sem acionar a validacao nativa.
      aria-required={extras.obrigatorio ? true : undefined}
      {...(extras.maxLength ? { maxLength: extras.maxLength } : {})}
      {...(extras.placeholder ? { placeholder: extras.placeholder } : {})}
      {...(extras.inputMode ? { inputMode: extras.inputMode } : {})}
      {...(extras.dica ? { 'aria-describedby': `${campo}-dica` } : {})}
      onChange={(evento) => {
        const bruto = evento.target.value;
        anotar(campo, extras.mascara ? extras.mascara(bruto) : bruto);
      }}
      data-testid={`campo-${campo}`}
    />
  );

  /**
   * `<select>` NATIVO -- a mesma escolha que `SelectField` de `@arenahub/ui`
   * defende, e que esta tela era a unica do painel a nao seguir.
   *
   * O combobox de `<div>` que morava aqui custava tres remendos, todos
   * documentados em comentario e todos desnecessarios agora:
   *
   *   1. `<input type="hidden">` espelhando o valor, porque o componente NAO
   *      envia nada ao `FormData` -- ele e um botao com menu.
   *   2. `items={...}` mapeando valor -> rotulo, senao o gatilho exibia
   *      "FEMALE" e o UUID cru da unidade.
   *   3. `value=''` em vez de `undefined`, para o Base UI nao nascer
   *      nao-controlado e virar controlado na primeira selecao.
   *
   * O nativo dispensa os tres: ele envia sozinho, mostra o texto da `<option>`
   * e aceita `value=''` sem ambiguidade. Alem disso, o teclado, o leitor de
   * tela e o toque ja funcionam sem ninguem os reimplementar -- e o E2E volta
   * a poder usar `selectOption`, que o combobox quebrava (issue #231).
   *
   * A `<option>` vazia carrega o placeholder: `<select>` nativo nao tem
   * atributo proprio para isso, e sem ela o primeiro item apareceria como se
   * ja estivesse escolhido.
   */
  const selecao = (
    campo: string,
    opcoes: readonly (readonly [string, string])[],
    placeholder: string,
  ) => (
    <div className={estilos['moldura']}>
      <select
        className={estilos['controle']}
        id={campo}
        name={campo}
        value={valor(campo)}
        onChange={(evento) => {
          anotar(campo, evento.target.value);
        }}
        data-testid={`campo-${campo}`}
      >
        <option value="">{placeholder}</option>

        {opcoes.map(([chave, texto]) => (
          <option key={chave} value={chave}>
            {texto}
          </option>
        ))}
      </select>

      {/*
        Seta DECORATIVA, desenhada em CSS -- mesma solucao do `SelectField` do
        DS. `aria-hidden` porque quem usa leitor de tela ouve o proprio
        `<select>` se anunciar como combobox; a seta repetiria isso em ruido.
      */}
      <span className={estilos['seta']} aria-hidden="true" />
    </div>
  );

  if (estado.sucesso) {
    return (
      <div className={estilos['sucesso']} role="status" data-testid="aluno-cadastrado">
        <h2>Aluno cadastrado</h2>

        <p>
          Matrícula:{' '}
          <strong className={estilos['matricula']} data-testid="matricula-gerada">
            {estado.sucesso.membershipNumber}
          </strong>
        </p>

        {/*
          Duplicata AVISA, não bloqueia (INV-014). Quem decide se são a mesma
          pessoa é a recepção, que tem o contexto que o servidor não tem —
          homônimos existem, e recusar o cadastro deixaria um aluno real de
          fora por causa de uma coincidência de nome.
        */}
        {estado.sucesso.duplicatas.length > 0 ? (
          <section
            className={estilos['duplicatas']}
            aria-labelledby="titulo-duplicatas"
            data-testid="possiveis-duplicatas"
          >
            <h3 id="titulo-duplicatas">Cadastros parecidos já existentes</h3>

            <p>
              O aluno foi cadastrado. Confira se não é a mesma pessoa — se for, arquive um dos
              cadastros para não dividir o histórico.
            </p>

            <ul className={estilos['listaDeDuplicatas']}>
              {estado.sucesso.duplicatas.map((duplicata) => (
                <li key={duplicata.studentId} data-testid={`duplicata-${duplicata.studentId}`}>
                  <a href={`/students/${duplicata.studentId}`}>{duplicata.fullName}</a> (
                  {duplicata.membershipNumber}) —{' '}
                  {MOTIVO_DA_DUPLICATA[duplicata.motivo] ?? duplicata.motivo}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={estilos['acoes']}>
          {/*
            `href` no proprio `Button` -- o componente do DS renderiza um `<a>`
            de verdade quando recebe a prop, e botao que navega TEM de ser
            link: um `<button onClick>` perde abrir em nova aba, copiar
            endereco e o anuncio de "link" do leitor de tela.

            Substitui o `render={<a>}` + `nativeButton={false}` que o Base UI
            exigia. A regra e a mesma; o DS so a expoe por uma prop em vez de
            por composicao.
          */}
          <Button href={`/students/${estado.sucesso.studentId}`} data-testid="abrir-ficha">
            Abrir a ficha e atribuir um plano
          </Button>

          <Button href="/students/novo" variant="outline">
            Cadastrar outro aluno
          </Button>
        </div>
      </div>
    );
  }

  /**
   * Barra o envio quando falta obrigatorio, e LEVA ao passo onde ele mora.
   *
   * Devolver `false` sozinho deixaria a pessoa presa: ela ve a mensagem no
   * passo 4 e o campo esta no passo 1. Levar sem avisar seria pior ainda --
   * a tela mudaria sem explicacao.
   */
  const faltaObrigatorio = (): boolean => {
    const pendente = OBRIGATORIOS.find((o) => valor(o.campo).trim() === '');

    if (!pendente) {
      setFaltando(null);
      return false;
    }

    setFaltando(`Antes de concluir, informe ${pendente.rotulo}.`);
    setPasso(pendente.passo);

    return true;
  };

  /**
   * Envia, ou barra e leva ao passo do campo que falta.
   *
   * Devolver sem chamar `acao` deixa o formulario como esta -- nada vai ao
   * servidor, e o rascunho continua inteiro.
   */
  const enviar = (formulario: FormData): void => {
    if (faltaObrigatorio()) return;

    acao(formulario);
  };

  const ehUltimo = passo === PASSOS.length - 1;

  /**
   * Preenchimento do passo. A regra e pura e mora em `src/students/trilha.ts`
   * -- aqui so entram os tres estados do React que ela precisa ler.
   *
   * NAO inclui "atual", e isso e deliberado: preenchimento e posicao sao
   * eixos INDEPENDENTES. Junta-los criou um ponto cego visto na tela -- com a
   * unidade em falta e a pessoa parada no passo 3, "atual" vencia "pendente"
   * e a trilha ficava calada enquanto o toast pedia a unidade. Por isso o
   * markup carrega `data-estado` e `data-atual` separados.
   */
  const estadoDoPasso = (indice: number) =>
    calcularEstadoDoPasso(indice, OBRIGATORIOS, valor, Boolean(faltando));

  return (
    <div className={estilos['wizard']}>
      <nav className={estilos['trilha']} aria-label="Etapas do cadastro">
        <ol className={estilos['passos']}>
          {PASSOS.map((titulo, indice) => (
            <li key={titulo}>
              <button
                type="button"
                className={estilos['passo']}
                /*
                  O ESTADO VAI NUM `data-`, e nao em classe concatenada: com
                  quatro estados, a expressao ternaria aninhada que havia aqui
                  ja estava ilegivel, e o CSS passa a selecionar por
                  `[data-estado=...]` em vez de por nome de classe montado em
                  JavaScript.
                */
                data-estado={estadoDoPasso(indice)}
                data-atual={indice === passo ? 'true' : undefined}
                onClick={() => setPasso(indice)}
                // `aria-current` é o que anuncia "você está aqui" para o
                // leitor de tela; o destaque visual sozinho não faz isso.
                {...(indice === passo ? { 'aria-current': 'step' as const } : {})}
                data-testid={`ir-para-passo-${indice + 1}`}
              >
                <span className={estilos['numero']} aria-hidden="true">
                  {/*
                    ÍCONE ALÉM DE COR -- DS-PAINEL §10: nenhum estado se
                    comunica por cor sozinha. Pronto vira ✓ e pendente vira !;
                    quem não distingue verde de vermelho, quem opera com
                    brilho baixo e quem imprime a tela leem a mesma coisa.
                    O número volta quando não há o que dizer.
                  */}
                  {estadoDoPasso(indice) === 'pendente'
                    ? '!'
                    : estadoDoPasso(indice) === 'pronto' && indice !== passo
                      ? '✓'
                      : indice + 1}
                </span>

                <span className={estilos['tituloDaTrilha']}>{titulo}</span>

                {/*
                  O leitor de tela NÃO recebe o ícone (o `<span>` acima é
                  `aria-hidden`): recebe esta frase, que diz o mesmo em
                  palavras. Sem ela, quem usa leitor ouviria só o título do
                  passo e perderia a informação inteira.
                */}
                {estadoDoPasso(indice) === 'pronto' ? (
                  <span className={estilos['apenasLeitor']}>— preenchido</span>
                ) : estadoDoPasso(indice) === 'pendente' ? (
                  <span className={estilos['apenasLeitor']}>— falta preencher</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>

        <p className={estilos['aviso']}>
          A biometria facial é capturada em etapa separada, depois do aceite do termo.
        </p>
      </nav>

      {/*
        A VALIDACAO ENVOLVE A ACTION, e nao vive num `onSubmit`.
        Com `action`, o React roda o envio dentro de uma Transition, e o
        `preventDefault` do `onSubmit` NAO a cancela -- os dois sao caminhos
        alternativos, nao encadeados (documentacao do `<form>` no React).
        Medido: com `onSubmit`, o clique no formulario vazio nao produzia
        erro nenhum e a tela ficava parada no passo 4.

        Envolver a action funciona para o clique E para o Enter dentro de um
        campo, que e o outro caminho de envio.
      */}
      <form className={estilos['cartao']} action={enviar}>
        {/*
          Todos os passos ficam montados; só o corrente aparece. `hidden` no
          contêiner tira o bloco da árvore de acessibilidade junto — sem ele o
          leitor de tela leria os quatro passos de uma vez.
        */}
        <div hidden={passo !== 0}>
          <h2 className={estilos['tituloDoPasso']}>Dados pessoais</h2>

          <div className={estilos['grade']}>
            <Campo id="fullName" rotulo="Nome completo" marca="obrigatório" larguraTotal>
              {entrada('fullName', {
                maxLength: 160,
                placeholder: 'Ex.: Rodrigo Ramires',
                obrigatorio: true,
              })}
            </Campo>

            <Campo
              id="cpf"
              rotulo="CPF"
              marca="obrigatório"
              dica="Exigido pelo antifraude do pagamento com cartão (ADR-043). A matrícula não depende do CPF."
            >
              {entrada('cpf', {
                mascara: mascararCpf,
                placeholder: '000.000.000-00',
                inputMode: 'numeric',
                obrigatorio: true,
                dica: true,
              })}
            </Campo>

            <Campo id="birthDate" rotulo="Data de nascimento" marca="obrigatório">
              {entrada('birthDate', { tipo: 'date', obrigatorio: true })}
            </Campo>

            <Campo id="rg" rotulo="RG" marca="opcional">
              {entrada('rg', { maxLength: 40, placeholder: '00.000.000-0' })}
            </Campo>

            <Campo id="registeredSex" rotulo="Sexo cadastral" marca="opcional">
              {selecao('registeredSex', SEXO_CADASTRAL, 'Selecione')}
            </Campo>

            <Campo id="telefone" rotulo="Telefone" marca="opcional">
              {entrada('telefone', {
                mascara: mascararTelefone,
                placeholder: '(00) 00000-0000',
                inputMode: 'tel',
              })}
            </Campo>

            <Campo id="whatsapp" rotulo="WhatsApp" marca="opcional">
              {entrada('whatsapp', {
                mascara: mascararTelefone,
                placeholder: '(00) 00000-0000',
                inputMode: 'tel',
              })}
            </Campo>

            <Campo id="email" rotulo="E-mail" marca="opcional">
              {entrada('email', {
                tipo: 'email',
                maxLength: 160,
                placeholder: 'nome@email.com',
                inputMode: 'email',
              })}
            </Campo>
          </div>
        </div>

        <div hidden={passo !== 1}>
          <h2 className={estilos['tituloDoPasso']}>Endereço e emergência</h2>

          <fieldset className={estilos['secao']}>
            <legend className={estilos['legenda']}>Endereço</legend>

            <div className={estilos['grade']}>
              <Campo
                id="cep"
                rotulo="CEP"
                marca="opcional"
                dica="O endereço é gravado quando CEP, logradouro, cidade e UF vêm juntos — endereço pela metade não localiza ninguém."
              >
                {entrada('cep', {
                  mascara: mascararCep,
                  placeholder: '00000-000',
                  inputMode: 'numeric',
                  dica: true,
                })}
              </Campo>

              <Campo id="logradouro" rotulo="Logradouro" marca="opcional">
                {entrada('logradouro', { maxLength: 200, placeholder: 'Rua, avenida, estrada' })}
              </Campo>

              <Campo id="numero" rotulo="Número" marca="opcional">
                {entrada('numero', { maxLength: 20, placeholder: 's/n quando não houver' })}
              </Campo>

              <Campo id="complemento" rotulo="Complemento" marca="opcional">
                {entrada('complemento', { maxLength: 120, placeholder: 'Apto, bloco' })}
              </Campo>

              <Campo id="bairro" rotulo="Bairro" marca="opcional">
                {entrada('bairro', { maxLength: 120 })}
              </Campo>

              <Campo id="cidade" rotulo="Cidade" marca="opcional">
                {entrada('cidade', { maxLength: 120 })}
              </Campo>

              <Campo id="uf" rotulo="Estado" marca="opcional">
                {selecao(
                  'uf',
                  UFS.map((uf) => [uf, uf] as const),
                  'UF',
                )}
              </Campo>
            </div>
          </fieldset>

          <fieldset className={estilos['secao']}>
            <legend className={estilos['legenda']}>Contato de emergência</legend>

            <div className={estilos['grade']}>
              <Campo
                id="emergenciaNome"
                rotulo="Nome"
                marca="opcional"
                dica="É para quem a academia liga se o aluno passar mal aqui dentro."
              >
                {entrada('emergenciaNome', { maxLength: 160, dica: true })}
              </Campo>

              <Campo id="emergenciaParentesco" rotulo="Parentesco" marca="opcional">
                {entrada('emergenciaParentesco', { maxLength: 80, placeholder: 'Ex.: cônjuge' })}
              </Campo>

              <Campo id="emergenciaTelefone" rotulo="Telefone" marca="opcional">
                {entrada('emergenciaTelefone', {
                  mascara: mascararTelefone,
                  placeholder: '(00) 00000-0000',
                  inputMode: 'tel',
                })}
              </Campo>
            </div>
          </fieldset>
        </div>

        <div hidden={passo !== 2}>
          <h2 className={estilos['tituloDoPasso']}>Administrativo</h2>

          <div className={estilos['grade']}>
            <Campo
              id="matricula-preview"
              rotulo="Matrícula"
              dica="Gerada pelo servidor no momento do cadastro, e independente do CPF."
            >
              {/*
                Só leitura, e SEM `name`: a matrícula é gerada pelo servidor e
                é imutável (INV-010). Enviá-la faria a API recusar o corpo
                inteiro — o schema é `.strict()`.
              */}
              <input
                className={estilos['controle']}
                id="matricula-preview"
                value="Gerada ao concluir o cadastro"
                readOnly
                disabled
                aria-describedby="matricula-preview-dica"
                data-testid="campo-matricula-preview"
              />
            </Campo>

            <Campo id="gymUnitId" rotulo="Unidade" marca="obrigatório">
              {selecao(
                'gymUnitId',
                unidades.map((u) => [u.id, u.name] as const),
                'Selecione a unidade',
              )}
            </Campo>

            <Campo id="leadSource" rotulo="Origem do lead" marca="opcional">
              {selecao('leadSource', ORIGENS_DO_LEAD, 'Selecione')}
            </Campo>

            <Campo id="status" rotulo="Situação inicial" marca="opcional">
              {selecao('status', SITUACAO_INICIAL, 'Lead')}
            </Campo>
          </div>
        </div>

        <div hidden={passo !== 3}>
          <h2 className={estilos['tituloDoPasso']}>Plano e consentimentos</h2>

          {/*
            NÃO DUPLICA A F7 NEM A F8. Plano e consentimento biométrico já têm
            tela própria, com regras próprias — atribuir plano gera assinatura
            e entitlement, e o consentimento exige termo versionado e
            responsável legal quando o aluno é menor. Refazer os dois aqui
            criaria um segundo caminho, com metade das regras.
          */}
          <p>
            O plano e os consentimentos são atribuídos na ficha do aluno, depois do cadastro. Cada
            um tem regra própria: o plano gera assinatura e direito de acesso; o consentimento
            biométrico registra a versão do termo aceito e, para menor de 18 anos, exige
            responsável legal identificado.
          </p>

          <p className={estilos['dica']}>
            Ao concluir, a ficha abre com os dois atalhos. A biometria facial é capturada só depois
            do aceite do termo — recusá-la não impede o acesso: QR, cartão e liberação assistida
            continuam valendo.
          </p>
        </div>

        <div className={estilos['acoes']}>
          <Button href="/students" variant="ghost">
            Cancelar
          </Button>

          {passo > 0 ? (
            <Button
              type="button"
              variant="outline"
              className={estilos['aDireita']}
              onClick={() => setPasso((atual) => atual - 1)}
              data-testid="voltar-passo"
            >
              ← Voltar
            </Button>
          ) : null}

          {ehUltimo ? (
            <span className={passo > 0 ? '' : estilos['aDireita']}>
              <BotaoDeEnvio />
            </span>
          ) : (
            <Button
              type="button"
              className={passo > 0 ? '' : estilos['aDireita']}
              onClick={() => setPasso((atual) => atual + 1)}
              data-testid="avancar-passo"
            >
              Continuar →
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
