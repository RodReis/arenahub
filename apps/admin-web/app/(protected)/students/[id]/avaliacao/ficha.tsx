'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, Icon, TextareaField, useToast, type IconName } from '@arenahub/ui';

import { salvarFicha } from '../../../../actions/avaliacao-fisica';
import { numeroLegivel } from '../../../../../src/health/formatar';
import {
  calcularIndicadores,
  idadeEm,
  type Entradas,
  type Equacao,
  type Sexo,
} from '../../../../../src/health/indicadores';
import estilos from './avaliacao.module.css';
import { Leitura } from './leitura';

type Chave = keyof Entradas;

interface Campo {
  readonly chave: Chave;
  readonly rotulo: string;
  readonly unidade: string;
  /** Tipo de `BodyMeasurement` que guarda o campo — para reabrir o rascunho. */
  readonly tipo: string;
  readonly hint?: string;
}

interface Grupo {
  readonly titulo: string;
  readonly icone: IconName;
  readonly campos: readonly Campo[];
}

/** A ordem é a da medição na sala: balança, fita métrica, esfigmomanômetro. */
const GRUPOS: readonly Grupo[] = [
  {
    titulo: 'Composição corporal',
    icone: 'weight',
    campos: [
      { chave: 'pesoKg', rotulo: 'Peso', unidade: 'kg', tipo: 'WEIGHT' },
      { chave: 'estaturaCm', rotulo: 'Estatura', unidade: 'cm', tipo: 'HEIGHT' },
      {
        chave: 'gorduraPct',
        rotulo: 'Gordura corporal',
        unidade: '%',
        tipo: 'BODY_FAT_PERCENT',
        hint: 'Bioimpedância, dobras cutâneas ou DEXA.',
      },
    ],
  },
  {
    titulo: 'Circunferências',
    icone: 'ruler',
    campos: [
      { chave: 'cinturaCm', rotulo: 'Cintura', unidade: 'cm', tipo: 'WAIST_CIRCUMFERENCE' },
      { chave: 'quadrilCm', rotulo: 'Quadril', unidade: 'cm', tipo: 'HIP_CIRCUMFERENCE' },
    ],
  },
  {
    titulo: 'Cardiovascular',
    icone: 'heart-pulse',
    campos: [
      { chave: 'pas', rotulo: 'PA sistólica', unidade: 'mmHg', tipo: 'BLOOD_PRESSURE_SYSTOLIC' },
      { chave: 'pad', rotulo: 'PA diastólica', unidade: 'mmHg', tipo: 'BLOOD_PRESSURE_DIASTOLIC' },
      { chave: 'fcRepouso', rotulo: 'FC de repouso', unidade: 'bpm', tipo: 'HEART_RATE' },
      {
        chave: 'vo2max',
        rotulo: 'VO₂máx',
        unidade: 'ml/kg/min',
        tipo: 'VO2_MAX',
        hint: 'Ergoespirometria ou teste/equação validada.',
      },
    ],
  },
];

const CAMPOS = GRUPOS.flatMap((grupo) => grupo.campos);

export interface Rascunho {
  id: string;
  assessedOn: string;
  notes: string;
  /** `originalValue` por tipo de medida. */
  medidas: Record<string, number>;
}

interface Props {
  studentId: string;
  nascimento: string;
  sexo: Sexo | null;
  /** `AAAA-MM-DD` no fuso da academia, calculado no servidor. */
  hoje: string;
  rascunho?: Rascunho | undefined;
  outrosRascunhos: readonly { id: string; assessedOn: string }[];
}

/** "72,5" ou "72.5" → 72.5. Vazio → `null`. Lixo ou zero → `NaN`, que o campo acusa. */
function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');

  if (limpo === '') return null;

  const valor = /^\d+(\.\d+)?$/.test(limpo) ? Number(limpo) : Number.NaN;

  return valor > 0 ? valor : Number.NaN;
}

function textoDe(valor: number | undefined): string {
  return valor === undefined ? '' : String(valor).replace('.', ',');
}

function dataLegivel(iso: string): string {
  const [ano, mes, dia] = iso.split('-');

  return `${dia}/${mes}/${ano}`;
}

/**
 * Ficha de avaliação física — F91 (SPEC-091).
 *
 * Medidas à esquerda, leitura à direita, ao vivo: cada número digitado
 * recalcula os 14 indicadores das tabelas do PI e pousa o valor na régua da
 * faixa. O professor mostra a tela ao aluno enquanto mede.
 *
 * Grava por `salvarFicha` (rascunho → publicar). O formulário nunca limpa o
 * que foi digitado em erro (DS-PAINEL §6).
 */
export function FichaDeAvaliacao({
  studentId,
  nascimento,
  sexo,
  hoje,
  rascunho,
  outrosRascunhos,
}: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [textos, setTextos] = useState<Record<Chave, string>>(() =>
    Object.fromEntries(
      CAMPOS.map((campo) => [campo.chave, textoDe(rascunho?.medidas[campo.tipo])]),
    ) as Record<Chave, string>,
  );
  const [data, setData] = useState(rascunho?.assessedOn ?? hoje);
  const [notas, setNotas] = useState(rascunho?.notes ?? '');
  const [equacao, setEquacao] = useState<Equacao>('TRADICIONAL');
  const [enviando, setEnviando] = useState<'rascunho' | 'publicar' | null>(null);

  const lidos = Object.fromEntries(
    CAMPOS.map((campo) => [campo.chave, lerNumero(textos[campo.chave])]),
  ) as Record<Chave, number | null>;
  const invalidos = CAMPOS.filter((campo) => Number.isNaN(lidos[campo.chave]));
  const paTrocada =
    lidos.pas !== null && lidos.pad !== null && !Number.isNaN(lidos.pas) && lidos.pas <= lidos.pad;
  const entradas = Object.fromEntries(
    CAMPOS.map((campo) => {
      const valor = lidos[campo.chave];

      return [campo.chave, valor === null || Number.isNaN(valor) ? null : valor];
    }),
  ) as unknown as Entradas;

  const perfil = { sexo, idade: idadeEm(nascimento, data) };
  const r = calcularIndicadores(entradas, perfil, equacao);
  const preenchidos = CAMPOS.filter((campo) => entradas[campo.chave] !== null).length;

  async function salvar(publicar: boolean): Promise<void> {
    if (enviando !== null) return;

    if (invalidos.length > 0) {
      show('warn', `Confira ${invalidos[0]!.rotulo}: use só número, com vírgula.`, 'erro-da-ficha');
      return;
    }

    if (paTrocada) {
      show('warn', 'A sistólica precisa ser maior que a diastólica.', 'erro-da-ficha');
      return;
    }

    setEnviando(publicar ? 'publicar' : 'rascunho');

    try {
      const resultado = await salvarFicha({
        studentId,
        assessmentId: rascunho?.id,
        assessedOn: data,
        notes: notas,
        publicar,
        entradas,
      });

      if (!resultado.ok) {
        show('warn', resultado.error, 'erro-da-ficha');
        // Rascunho criado e publicação falhou: segue editando ESTE rascunho, senão
        // a próxima tentativa criaria outro.
        if (resultado.assessmentId && !rascunho) {
          router.push(`/students/${studentId}/avaliacao?rascunho=${resultado.assessmentId}`);
        }
        return;
      }

      if (resultado.publicada) {
        show('info', 'Avaliação publicada. Ela já aparece no histórico.', 'ficha-publicada');
        router.push(`/students/${studentId}/avaliacao?aba=historico`);
      } else {
        show('info', 'Rascunho salvo.', 'ficha-salva');
        router.push(`/students/${studentId}/avaliacao?rascunho=${resultado.assessmentId}`);
      }
      router.refresh();
    } catch {
      show('error', 'Não foi possível salvar a ficha. O que você digitou segue na tela.', 'erro-da-ficha');
    } finally {
      setEnviando(null);
    }
  }

  const n = (valor: number | null, casas: number): string =>
    valor === null ? '—' : numeroLegivel(valor, casas);

  const falta = (...rotulos: string[]) => `Preencha ${rotulos.join(' e ')}.`;

  // Unidade só ao lado de número: "— bpm" afirmaria uma medida que não existe.
  const comUnidade = (valor: number | null, casas: number, unidade: string) =>
    valor === null ? (
      '—'
    ) : (
      <>
        {numeroLegivel(valor, casas)}
        <span> {unidade}</span>
      </>
    );

  return (
    <div className={estilos['ficha']} data-testid="ficha-de-avaliacao">
      <form
        className={estilos['medidas']}
        aria-label="Medidas da avaliação"
        onSubmit={(evento) => {
          evento.preventDefault();
          void salvar(true);
        }}
      >
        {outrosRascunhos.length > 0 ? (
          <div className={estilos['rascunhos']} role="note">
            <Icon name="pencil" />
            <span>
              {outrosRascunhos.length === 1 ? 'Há um rascunho de ' : 'Há rascunhos de '}
              {outrosRascunhos.map((outro, i) => (
                <span key={outro.id}>
                  {i > 0 ? ', ' : ''}
                  <a href={`/students/${studentId}/avaliacao?rascunho=${outro.id}`}>
                    {dataLegivel(outro.assessedOn)}
                  </a>
                </span>
              ))}
              .
            </span>
          </div>
        ) : null}

        <Field
          id="ficha-data"
          type="date"
          label="Data da avaliação"
          value={data}
          max={hoje}
          disabled={rascunho !== undefined}
          {...(rascunho ? { hint: 'A data do rascunho não muda depois de criado.' } : {})}
          onChange={(evento) => setData(evento.target.value || hoje)}
        />

        {GRUPOS.map((grupo) => (
          <fieldset key={grupo.titulo} className={estilos['grupo']}>
            <legend className={estilos['legenda']}>
              <Icon name={grupo.icone} />
              {grupo.titulo}
            </legend>
            <div className={estilos['campos']}>
              {grupo.campos.map((campo) => (
                <Field
                  key={campo.chave}
                  id={`ficha-${campo.chave}`}
                  label={campo.rotulo}
                  unit={campo.unidade}
                  inputMode="decimal"
                  autoComplete="off"
                  value={textos[campo.chave]}
                  {...(campo.hint ? { hint: campo.hint } : {})}
                  {...(Number.isNaN(lidos[campo.chave])
                    ? { error: 'Use só número maior que zero, com vírgula.' }
                    : campo.chave === 'pas' && paTrocada
                      ? { error: 'A sistólica precisa ser maior que a diastólica.' }
                      : {})}
                  data-testid={`campo-${campo.chave}`}
                  onChange={(evento) =>
                    setTextos((atual) => ({ ...atual, [campo.chave]: evento.target.value }))
                  }
                />
              ))}
            </div>
          </fieldset>
        ))}

        <TextareaField
          id="ficha-notas"
          label="Observações"
          hint="Jejum, horário, aparelho usado, método do %GC."
          value={notas}
          maxLength={2000}
          rows={3}
          onChange={(evento) => setNotas(evento.target.value)}
        />

        <div className={estilos['acoes']}>
          <p className={estilos['progresso']} aria-live="polite">
            {preenchidos} de {CAMPOS.length} medidas
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={enviando !== null || preenchidos === 0}
            onClick={() => void salvar(false)}
            data-testid="salvar-rascunho"
          >
            {enviando === 'rascunho' ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
          <Button
            type="submit"
            disabled={enviando !== null || preenchidos === 0}
            data-testid="publicar-avaliacao"
          >
            <Icon name="check-circle" />
            {enviando === 'publicar' ? 'Publicando…' : 'Publicar avaliação'}
          </Button>
          <p className={estilos['aviso-publicar']}>
            Publicada, a avaliação não se edita: correção vira nova versão vinculada.
          </p>
        </div>
      </form>

      <div className={estilos['leituras']} aria-label="Leitura dos indicadores" role="region">
        <section className={estilos['familia']} aria-labelledby="familia-composicao">
          <h2 id="familia-composicao" className={estilos['titulo-familia']}>
            Composição corporal
          </h2>
          <div className={estilos['grade']} data-itens="2">
            <Leitura
              numero={1}
              rotulo="IMC"
              nome="Índice de massa corporal"
              valor={n(r.imc.valor, 1)}
              unidade="kg/m²"
              indicador={r.imc}
              formatar={(v) => numeroLegivel(v, 1)}
              vazio={falta('peso', 'estatura')}
              testId="leitura-imc"
            />
            <Leitura
              numero={5}
              rotulo="%GC"
              nome="Percentual de gordura"
              valor={n(r.gordura.valor, 1)}
              unidade="%"
              indicador={r.gordura}
              formatar={(v) => numeroLegivel(v, 0)}
              vazio={falta('gordura corporal')}
              testId="leitura-gordura"
              complemento={
                <>
                <dl className={estilos['apoio-numeros']}>
                  <div>
                    <dt>6. MG · Massa de gordura</dt>
                    <dd data-testid="leitura-mg">{comUnidade(r.massaGorda.valor, 1, 'kg')}</dd>
                  </div>
                  <div>
                    <dt>7. MLG · Massa livre de gordura</dt>
                    <dd data-testid="leitura-mlg">{comUnidade(r.massaMagra.valor, 1, 'kg')}</dd>
                  </div>
                </dl>
                <p className={estilos['ressalva']}>
                  Sem ponto de corte em kg: ler pelo %GC, sexo, idade e estatura.
                </p>
                </>
              }
            />
          </div>
        </section>

        <section className={estilos['familia']} aria-labelledby="familia-circunferencias">
          <h2 id="familia-circunferencias" className={estilos['titulo-familia']}>
            Circunferências
          </h2>
          <div className={estilos['grade']} data-itens="3">
            <Leitura
              numero={2}
              rotulo="CC"
              nome="Circunferência da cintura"
              valor={n(r.cintura.valor, 1)}
              unidade="cm"
              indicador={r.cintura}
              formatar={(v) => numeroLegivel(v, 0)}
              vazio={falta('cintura')}
              testId="leitura-cintura"
            />
            <Leitura
              numero={3}
              rotulo="RCE"
              nome="Relação cintura/estatura"
              valor={n(r.rce.valor, 2)}
              indicador={r.rce}
              formatar={(v) => numeroLegivel(v, 2)}
              vazio={falta('cintura', 'estatura')}
              testId="leitura-rce"
            />
            <Leitura
              numero={4}
              rotulo="RCQ"
              nome="Relação cintura/quadril"
              valor={n(r.rcq.valor, 2)}
              indicador={r.rcq}
              formatar={(v) => numeroLegivel(v, 2)}
              vazio={falta('cintura', 'quadril')}
              testId="leitura-rcq"
            />
          </div>
        </section>

        <section className={estilos['familia']} aria-labelledby="familia-cardio">
          <h2 id="familia-cardio" className={estilos['titulo-familia']}>
            Cardiovascular
          </h2>
          <div className={estilos['grade']} data-itens="3">
            <Leitura
              numero={8}
              rotulo="PA"
              nome="Pressão arterial"
              valor={
                entradas.pas !== null && entradas.pad !== null
                  ? `${n(entradas.pas, 0)}/${n(entradas.pad, 0)}`
                  : '—'
              }
              unidade="mmHg"
              indicador={r.pa}
              ressalva="Uma única medida não diagnostica hipertensão."
              formatar={(v) => numeroLegivel(v, 0)}
              vazio={falta('sistólica', 'diastólica')}
              testId="leitura-pa"
            />
            <Leitura
              numero={9}
              rotulo="PAM"
              nome="Pressão arterial média"
              valor={n(r.pam.valor, 0)}
              unidade="mmHg"
              indicador={r.pam}
              formatar={(v) => numeroLegivel(v, 0)}
              vazio={falta('sistólica', 'diastólica')}
              testId="leitura-pam"
            />
            <Leitura
              numero={10}
              rotulo="FCR"
              nome="Frequência cardíaca de repouso"
              valor={n(r.fcRepouso.valor, 0)}
              unidade="bpm"
              indicador={r.fcRepouso}
              formatar={(v) => numeroLegivel(v, 0)}
              vazio={falta('FC de repouso')}
              testId="leitura-fcr"
            />
          </div>
        </section>

        <section className={estilos['familia']} aria-labelledby="familia-capacidade">
          <div className={estilos['cabeca-familia']}>
            <h2 id="familia-capacidade" className={estilos['titulo-familia']}>
              Capacidade e treino
            </h2>
            <div className={estilos['alternador']} role="group" aria-label="Equação da FCmáx">
              {(['TRADICIONAL', 'TANAKA'] as const).map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  aria-pressed={equacao === opcao}
                  onClick={() => setEquacao(opcao)}
                  data-testid={`equacao-${opcao.toLowerCase()}`}
                >
                  {opcao === 'TRADICIONAL' ? '220 − idade' : 'Tanaka'}
                </button>
              ))}
            </div>
          </div>

          <div className={estilos['capacidade']}>
            <dl className={estilos['numeros']}>
              <div>
                <dt>11. FCmáx estimada</dt>
                <dd data-testid="leitura-fcmax">
                  {comUnidade(equacao === 'TANAKA' ? r.fcMaxTanaka : r.fcMaxTradicional, 0, 'bpm')}
                </dd>
              </div>
              <div>
                <dt>12. Reserva de FC</dt>
                <dd data-testid="leitura-rfc">
                  {comUnidade(r.rfc, 0, 'bpm')}
                </dd>
              </div>
              <div>
                <dt>14. VO₂máx</dt>
                <dd data-testid="leitura-vo2">
                  {comUnidade(r.vo2max.valor, 1, 'ml/kg/min')}
                </dd>
              </div>
            </dl>

            <h3 id="titulo-zonas" className={estilos['titulo-zonas']}>
              13. Zonas de treino (Karvonen)
            </h3>
            {r.zonas.length > 0 ? (
              <ol className={estilos['zonas']} aria-labelledby="titulo-zonas" data-testid="zonas">
                {r.zonas.map((zona, i) => (
                  <li key={zona.de} className={estilos['zona']} data-nivel={i + 1}>
                    <span className={estilos['zona-faixa']}>
                      {zona.de}–{zona.ate}%
                    </span>
                    <strong className={estilos['zona-bpm']}>
                      {zona.bpmDe}–{zona.bpmAte}
                      <span> bpm</span>
                    </strong>
                    <span className={estilos['zona-nome']}>{zona.rotulo}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={estilos['zonas-vazio']}>
                {perfil.idade !== null && perfil.idade < 18
                  ? 'Menor de 18 anos: não aplicar equações adultas de FCmáx; usar teste ou referência pediátrica.'
                  : 'Zonas de Karvonen aparecem com a FC de repouso e a idade do cadastro.'}
              </p>
            )}
            <p className={estilos['nota']}>
              FCmáx e zonas são estimativas e faixas de prescrição, não medidas diagnósticas.
              VO₂máx: interpretar por sexo e faixa etária, sem ponto de corte único.
            </p>
          </div>
        </section>

        <p className={estilos['rodape']}>
          <Icon name="alert-circle" />
          Faixas das tabelas de referência — orientam a conversa, não são
          diagnóstico. Pontos de corte variam conforme população e diretriz.
        </p>
      </div>
    </div>
  );
}
