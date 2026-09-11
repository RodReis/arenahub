'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  Field,
  MaskedField,
  SectionCard,
  SelectField,
  TextareaField,
  useToastDeErro,
} from '@arenahub/ui';

import { mascararCnpj } from '@/lib/mascaras';

import estilos from '../../../formulario.module.css';
import proprios from './cliente.module.css';

import { alterarTenant, type EstadoDaEdicao } from '../../../actions/platform';
import { FUSOS } from '../../../(protected)/units/fusos';

const ESTADO_INICIAL: EstadoDaEdicao = {};

interface Props {
  readonly tenantId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly cnpj: string;
  readonly timezone: string;
  readonly responsavelNome: string;
  readonly responsavelEmail: string;
  readonly missionText: string;
  readonly highlightsText: string;
}

function BotaoDeSalvar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="salvar-academia">
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

/**
 * Edição cadastral do cliente — F61, reformada na F68.
 *
 * O IDENTIFICADOR NÃO É CAMPO: ele é a chave pública e permanente (a F62 fez
 * o login por ele). Na F68 subiu para a linha de identidade da página, acima
 * das abas: ele vale para as quatro seções, e como nota dentro desta só era
 * lido por quem abrisse justamente esta.
 *
 * TRÊS CARDS NUM `<form>` SÓ: são três assuntos — a empresa, quem responde por
 * ela, o que o aluno vê na entrada —, e o botão continua um só porque os três
 * salvam na mesma chamada. Um card por assunto com botão próprio daria três
 * requisições para o que a API resolve numa.
 *
 * `defaultValue` sai do estado quando há erro e do servidor quando não há: a
 * ação devolve o que foi digitado justamente para o formulário não esvaziar em
 * recusa.
 */
export function FormularioDeEdicao(props: Props) {
  const [estado, acao] = useActionState(alterarTenant, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-edicao');

  const valor = (campo: keyof Omit<Props, 'tenantId' | 'slug'>): string =>
    estado.valores?.[campo] ?? props[campo];

  return (
    <form className={proprios['formulario']} action={acao}>
      <input type="hidden" name="tenantId" value={props.tenantId} />

      <SectionCard
        title="Dados do cliente"
        icon="building"
        summary="A empresa que assina o contrato com o ArenaHub."
      >
        <div className={estilos['formulario']}>
      <Field
        id="nome-da-academia"
        name="displayName"
        label="Nome fantasia"
        defaultValue={valor('displayName')}
        maxLength={120}
        required
        data-testid="campo-nome-da-academia"
      />

      <Field
        id="razao-da-academia"
        name="legalName"
        label="Razão social"
        defaultValue={valor('legalName')}
        maxLength={200}
        required
        data-testid="campo-razao-da-academia"
      />

      <div className={estilos['par']}>
        <MaskedField
          id="cnpj-da-academia"
          name="cnpj"
          label="CNPJ"
          mascara={mascararCnpj}
          defaultValue={valor('cnpj')}
          required
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          hint="14 dígitos."
          data-testid="campo-cnpj-da-academia"
        />

        <SelectField
          id="fuso-da-academia"
          name="timezone"
          label="Fuso horário"
          defaultValue={valor('timezone')}
          required
          data-testid="campo-fuso-da-academia"
        >
          {FUSOS.map((fuso) => (
            <option key={fuso.valor} value={fuso.valor}>
              {fuso.rotulo}
            </option>
          ))}
        </SelectField>
      </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Responsável"
        icon="user-check"
        summary="Quem responde pelo cliente e recebe os avisos da plataforma."
      >
        <div className={estilos['par']}>
          <Field
            id="nome-do-responsavel"
            name="responsavelNome"
            label="Nome"
            defaultValue={valor('responsavelNome')}
            maxLength={120}
            required
            data-testid="campo-nome-do-responsavel"
          />

          <Field
            id="email-do-responsavel"
            name="responsavelEmail"
            label="E-mail"
            type="email"
            defaultValue={valor('responsavelEmail')}
            required
            data-testid="campo-email-do-responsavel"
          />
        </div>
      </SectionCard>

      {/*
        IDENTIDADE VISUAL -- F62 (ADR-052 §9).

        Os DOIS TEXTOS moram aqui, junto do cadastro, e não na aba de layout:
        eles se salvam com o mesmo botão do resto do cadastro, e cada upload de
        arquivo é um envio próprio (o navegador manda o arquivo na hora em que
        se escolhe salvar, e um formulário só faria corrigir um CNPJ reenviar o
        logo).
      */}
      <SectionCard
        title="Tela de entrada do cliente"
        icon="scan-face"
        summary={`Aparecem na coluna da esquerda de /${props.slug}/login, junto do logotipo.`}
      >
        <div className={estilos['formulario']}>
        <TextareaField
          id="missao-da-academia"
          name="missionText"
          label="Missão"
          defaultValue={valor('missionText')}
          maxLength={280}
          rows={2}
          hint="Uma frase. Deixe em branco para não exibir."
          data-testid="campo-missao-da-academia"
        />

        <TextareaField
          id="diferenciais-da-academia"
          name="highlightsText"
          label="Diferenciais"
          defaultValue={valor('highlightsText')}
          maxLength={500}
          rows={4}
          hint="Uma linha por diferencial. Deixe em branco para não exibir."
          data-testid="campo-diferenciais-da-academia"
        />
        </div>
      </SectionCard>

      {/*
        A BARRA DE AÇÕES GRUDA NO PÉ: com três cards a aba rola, e um botão no
        fim do documento obriga a rolar de volta depois de conferir qualquer
        campo acima.

        A confirmação fica NA TELA, e não só num toast: quem salvou precisa
        poder conferir depois de olhar para outro lado, e toast some sozinho.
      */}
      <div className={proprios['rodape']}>
        <BotaoDeSalvar />
        <Button href="/platform" variant="ghost">
          Voltar
        </Button>

        {estado.salvo ? (
          <p className={proprios['salvo']} role="status" data-testid="academia-salva">
            Alterações salvas.
          </p>
        ) : null}
      </div>
    </form>
  );
}
