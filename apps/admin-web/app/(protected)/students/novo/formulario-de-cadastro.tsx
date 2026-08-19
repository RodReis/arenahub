'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mascararCep, mascararCpf, mascararTelefone } from '@/lib/mascaras';

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
 * NOME, NASCIMENTO E UNIDADE SÃO OS ÚNICOS OBRIGATÓRIOS. O mockup marcava
 * CPF, telefone e e-mail também; o PI decidiu em 18/08 que o mockup é que se
 * corrige — a matrícula nunca depende do CPF (INV-009/011), e quem chega sem
 * documento é cadastrado do mesmo jeito.
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
    <Input
      id={campo}
      name={campo}
      type={extras.tipo ?? 'text'}
      value={valor(campo)}
      required={extras.obrigatorio ?? false}
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
   * Select do shadcn não envia valor sozinho: ele é um botão com menu, não um
   * `<select>`. O `<input type="hidden">` é o que faz o valor chegar ao
   * FormData da server action.
   */
  const selecao = (
    campo: string,
    opcoes: readonly (readonly [string, string])[],
    placeholder: string,
    obrigatorio = false,
  ) => (
    <>
      <Select
        value={valor(campo) || undefined}
        // O Base UI entrega `null` quando a seleção é limpa; o rascunho
        // guarda string, e `''` é o que representa "campo não informado" no
        // resto do formulário.
        onValueChange={(novo) => anotar(campo, novo ?? '')}
      >
        <SelectTrigger id={campo} className="w-full" data-testid={`campo-${campo}`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {opcoes.map(([chave, texto]) => (
            <SelectItem key={chave} value={chave}>
              {texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input type="hidden" name={campo} value={valor(campo)} required={obrigatorio} />
    </>
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
            `render` e não `asChild`: o shadcn deste projeto é construído
            sobre Base UI, não Radix. O elemento renderizado é um `<a>` de
            verdade — botão que navega tem de ser link, senão perde abrir em
            nova aba, copiar endereço e o anúncio de "link" do leitor de tela.
          */}
          <Button
            render={<a href={`/students/${estado.sucesso.studentId}`} />}
            data-testid="abrir-ficha"
          >
            Abrir a ficha e atribuir um plano
          </Button>

          <Button render={<a href="/students/novo" />} variant="outline">
            Cadastrar outro aluno
          </Button>
        </div>
      </div>
    );
  }

  const ehUltimo = passo === PASSOS.length - 1;

  return (
    <div className={estilos['wizard']}>
      <nav className={estilos['trilha']} aria-label="Etapas do cadastro">
        <ol className={estilos['passos']}>
          {PASSOS.map((titulo, indice) => (
            <li key={titulo}>
              <button
                type="button"
                className={`${estilos['passo']} ${indice === passo ? estilos['passoAtual'] : ''}`}
                onClick={() => setPasso(indice)}
                // `aria-current` é o que anuncia "você está aqui" para o
                // leitor de tela; o destaque visual sozinho não faz isso.
                {...(indice === passo ? { 'aria-current': 'step' as const } : {})}
                data-testid={`ir-para-passo-${indice + 1}`}
              >
                <span
                  className={`${estilos['numero']} ${
                    indice === passo
                      ? estilos['numeroAtual']
                      : indice < passo
                        ? estilos['numeroConcluido']
                        : ''
                  }`}
                  aria-hidden="true"
                >
                  {indice + 1}
                </span>
                {titulo}
              </button>
            </li>
          ))}
        </ol>

        <p className={estilos['aviso']}>
          A biometria facial é capturada em etapa separada, depois do aceite do termo.
        </p>
      </nav>

      <form className={estilos['cartao']} action={acao}>
        {estado.erro ? (
          <p className={estilos['erro']} role="alert" data-testid="erro-do-cadastro">
            {estado.erro}
          </p>
        ) : null}

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
              marca="opcional"
              dica="A matrícula não depende do CPF: quem chega sem documento é cadastrado normalmente. Quando informado, fica guardado cifrado e nunca aparece por inteiro nas telas."
            >
              {entrada('cpf', {
                mascara: mascararCpf,
                placeholder: '000.000.000-00',
                inputMode: 'numeric',
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
              <Input
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
                true,
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
          <Button render={<a href="/students" />} variant="ghost">
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
