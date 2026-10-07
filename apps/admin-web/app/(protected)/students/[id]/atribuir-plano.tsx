'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  Field,
  Icon,
  SelectField,
  TenantDateTime,
  TextareaField,
  formatarDinheiro,
  useToastDeErro,
} from '@arenahub/ui';

import estilos from '../../../formulario.module.css';
import painel from './atribuir-plano.module.css';

import { atribuirPlano, type EstadoDaAssinatura } from '../../../actions/membership';

interface Preco {
  amountMinor: number;
  currency: string;
}

interface Plano {
  id: string;
  name: string;
  isActive: boolean;
  /** Preco vigente hoje. Nulo = plano sem vigencia de preco. */
  currentPrice?: Preco | null;
}

/**
 * A assinatura vigente do aluno, quando existe.
 *
 * `version` é o que torna a TROCA possível: `POST /subscriptions/:id/actions`
 * exige a versão para cancelar, e sem ela o painel só sabia criar — nunca
 * substituir.
 */
export interface AssinaturaVigente {
  subscriptionId: string;
  version: number;
  planName: string | null;
  /** Preco vigente do plano atual -- o "De" do resumo da troca. */
  planCurrentPrice?: Preco | null;
  /** Ha cobranca recorrente no provedor: a troca NAO a leva para o plano novo. */
  recorrenciaAtiva?: boolean;
  /**
   * Fim da vigência ATUAL, em ISO.
   *
   * A troca de plano MANTÉM esta data (`trocarPlanoDaAssinatura` herda
   * `endsAt` da assinatura antiga) -- o formulário não pede mais
   * início/fim no modo troca, e este campo é o que a tela mostra no lugar
   * dos dois inputs (achado da revisão de branch inteiro).
   */
  endsAt: string;
  /**
   * Troca de plano JA agendada para o proximo ciclo (#337), se houver. O
   * nome vem da lista de planos; `null` quando o plano agendado saiu da lista.
   */
  trocaAgendada?: { planName: string | null; effectiveFrom: string } | undefined;
}

interface Props {
  studentId: string;
  planos: Plano[];
  /** `true` quando a situação do aluno impede o acesso (INV-033). */
  impedido: boolean;
  /**
   * Assinatura a substituir. Ausente = o aluno não tem plano, e o formulário
   * é o de atribuição de sempre.
   */
  vigente?: AssinaturaVigente | undefined;
  /**
   * Fuso da UNIDADE, para formatar `vigente.endsAt` (regra 5 do DS §11 --
   * `TenantDateTime` é a única formatação de data autorizada). Mesmo valor
   * que o `page.tsx` já usa (`FUSO_PROVISORIO`/`timezoneDaUnidade`).
   */
  timezone: string;
}

const ESTADO_INICIAL: EstadoDaAssinatura = {};

/** "Plano Ajuda — R$ 120,00": sem o preco, planos parecidos viram palpite. */
function rotuloDoPlano(plano: Plano): string {
  return plano.currentPrice
    ? `${plano.name} — ${formatarDinheiro(plano.currentPrice.amountMinor, plano.currentPrice.currency)}`
    : `${plano.name} — sem preço vigente`;
}

/** Diferenca so quando as duas moedas coincidem; senao, subtrair e inventar. */
function diferencaDePreco(de: Preco | null | undefined, para: Preco | null | undefined): number | null {
  if (!de || !para || de.currency !== para.currency) return null;

  return para.amountMinor - de.amountMinor;
}

/**
 * Botão que sabe quando está enviando.
 *
 * ESTA É A ÚNICA DEFESA contra o clique duplo aqui: a rota de assinatura não é
 * idempotente (decisão registrada na issue #7, aval do PI em 15/08/2026), e
 * duas submissões criam duas assinaturas e dois direitos de acesso para o
 * mesmo aluno. Quando o `Idempotency-Key` transversal chegar (INV-087), a
 * garantia passa para o servidor, onde deveria estar.
 */
function BotaoDeAtribuicao({ troca }: { troca: boolean }) {
  const { pending } = useFormStatus();

  const rotulo = troca ? 'Alterar plano' : 'Atribuir plano';

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-atribuicao">
      {pending ? (troca ? 'Alterando…' : 'Atribuindo…') : rotulo}
    </Button>
  );
}

/**
 * Atribuição manual de plano — `M1-AC-003`, Slice 1.2.
 *
 * Materializa o ADR-003: o direito de acesso nasce aqui, de uma decisão
 * humana registrada, e não de um pagamento. No MVP 2 a mesma cadeia passa a
 * ser alimentada por invoice — mas a catraca continua lendo só o entitlement.
 */
export function AtribuirPlano({ studentId, planos, impedido, vigente, timezone }: Props) {
  /*
   * FECHADO POR PADRÃO (decisão do PI, 24/08/2026).
   *
   * A aba Plano existe para RESPONDER "qual acesso este aluno tem" -- e o
   * formulário de cinco campos ocupava mais espaço que a resposta, empurrando
   * os direitos de acesso para cima da dobra. Trocar plano é ato pontual;
   * consultar é o que se faz o tempo todo.
   *
   * Fica aberto quando há erro de validação: `estado.valores` só existe
   * depois de uma tentativa, e fechar o formulário nesse caso esconderia da
   * recepção o que ela acabou de digitar.
   */
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(atribuirPlano, ESTADO_INICIAL);
  // O resumo da troca acompanha a escolha; o campo segue NAO controlado, e o
  // valor reenviado depois de um erro entra como ponto de partida.
  const [planoEscolhido, setPlanoEscolhido] = useState(estado.valores?.planId ?? '');
  // Erro vira TOAST -- CLAUDE.md: "sempre usar Toast para: Info, Warn e
  // error". O toast ja carrega `role="alert"`, entao o anuncio ao leitor de
  // tela nao regride com a saida do `<p role="alert">`.
  useToastDeErro(estado.erro, 'error', 'erro-da-atribuicao');


  const ativos = planos.filter((plano) => plano.isActive);

  if (ativos.length === 0) {
    return (
      <p data-testid="sem-planos">
        Nenhum plano ativo cadastrado. <a href="/plans">Cadastre um plano</a> antes de atribuir
        acesso.
      </p>
    );
  }

  const troca = vigente !== undefined;

  if (estado.sucesso) {
    const reabertas = estado.sucesso.parcelasReabertas ?? 0;

    return (
      <div role="status" className={painel['feito']} data-testid="plano-atribuido">
        {troca ? (
          <>
            <p>
              <strong>Plano trocado.</strong> O plano novo já vale, com a vigência mantida.
            </p>
            <p className={estilos['nota']}>
              {reabertas > 0
                ? `${reabertas === 1 ? '1 parcela aberta foi refeita' : `${reabertas} parcelas abertas foram refeitas`} no plano novo; a do plano anterior foi cancelada.`
                : 'Não havia parcela aberta para refazer. A próxima cobrança já sai no plano novo.'}
            </p>
          </>
        ) : (
          <p>Plano atribuído. O direito de acesso foi criado e já vale a partir do início da vigência.</p>
        )}
        <p>
          <a href={`/students/${studentId}`}>Atualizar a ficha</a>
        </p>
      </div>
    );
  }

  /*
   * O formulário só aparece quando pedido -- ou quando a tentativa falhou e
   * há preenchimento a preservar (ver `aberto`, no topo).
   */
  if (!aberto && !estado.valores) {
    return (
      <Button
        type="button"
        onClick={() => setAberto(true)}
        data-testid={`abrir-plano-${studentId}`}
      >
        <Icon name={troca ? 'refresh-cw' : 'dumbbell'} />
        {troca ? 'Alterar plano' : 'Atribuir plano'}
      </Button>
    );
  }

  const escolhido = ativos.find((plano) => plano.id === planoEscolhido);
  const diferenca = escolhido ? diferencaDePreco(vigente?.planCurrentPrice, escolhido.currentPrice) : null;

  return (
    <form className={painel['painel']} action={acao}>
      <input type="hidden" name="studentId" value={studentId} />

      {/*
        Id e versão da assinatura a cancelar. Vão JUNTOS -- a Server Action
        recusa um sem o outro, porque cancelar sem versão não é possível e
        seguir sem cancelar deixaria dois planos ativos.
      */}
      {troca ? (
        <>
          <input type="hidden" name="substituiSubscriptionId" value={vigente.subscriptionId} />
          <input type="hidden" name="substituiVersion" value={vigente.version} />
        </>
      ) : null}

      <div className={painel['campos']}>
        {/*
          Aviso ANTES da tentativa. A API recusaria com `STUDENT_NOT_ELIGIBLE`,
          mas descobrir isso depois de preencher vigência e motivo é trabalho
          jogado fora.
        */}
        {impedido ? (
          <p role="alert" data-testid="aviso-de-inelegibilidade">
            A situação atual deste aluno impede o acesso. Atribuir um plano agora não vai liberar a
            catraca — regularize a situação primeiro.
          </p>
        ) : null}

        {/*
          `data-testid` PRÓPRIO porque "Plano" virou nome ambíguo: a aba da
          ficha também se chama assim, e `getByLabel('Plano')` passou a casar
          com os dois (o painel leva `aria-labelledby="aba-plano"`). Os dois
          rótulos estão certos onde estão -- quem precisa desempatar é o teste.

          O PREÇO vai no texto da opção: dois planos de nome parecido e valores
          diferentes eram escolhidos no palpite.
        */}
        <SelectField
          id="plano"
          name="planId"
          label="Plano"
          data-testid="campo-plano"
          defaultValue={estado.valores?.planId ?? ''}
          onChange={(evento) => setPlanoEscolhido(evento.target.value)}
          required
        >
          <option value="">Selecione…</option>
          {ativos.map((plano) => (
            <option key={plano.id} value={plano.id}>
              {rotuloDoPlano(plano)}
            </option>
          ))}
        </SelectField>

        {/* Atribuição nova: início e fim lado a lado, a mesma decisão. */}
        {troca ? null : (
          <div className={estilos['par']}>
            <Field
              id="inicio"
              name="startsAt"
              label="Início da vigência"
              type="datetime-local"
              defaultValue={estado.valores?.startsAt ?? ''}
              required
              data-testid="campo-inicio"
            />

            <Field
              id="fim"
              name="endsAt"
              label="Fim da vigência"
              type="datetime-local"
              defaultValue={estado.valores?.endsAt ?? ''}
              required
              data-testid="campo-fim"
            />
          </div>
        )}

        <TextareaField
          id="motivo-atribuicao"
          name="reason"
          label="Motivo"
          defaultValue={estado.valores?.reason ?? ''}
          rows={2}
          maxLength={300}
          required
          data-testid="campo-motivo-atribuicao"
          hint="Registrado na auditoria. Ex.: “plano cadastrado errado”, “aluno pediu upgrade”."
        />

        <div className={estilos['acoes']}>
          <BotaoDeAtribuicao troca={troca} />
          <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
        </div>
      </div>

      {/*
        TROCA: o que MUDA, ao lado de onde se escolhe. A troca vale no ato
        (decisão do PI, 06/10/2026), sem proração nem crédito -- e a recepção
        precisa ver o De/Para e o que acontece com as parcelas ANTES de
        confirmar, não descobrir depois.
      */}
      {troca ? (
        <div className={painel['consequencia']} aria-live="polite">
          {escolhido ? (
            <div className={painel['resumo']} data-testid="resumo-da-troca">
              <div className={painel['linha']}>
                <span className={painel['rotuloDaLinha']}>De</span>
                <span className={painel['nomeDoPlano']}>{vigente.planName ?? 'Plano atual'}</span>
                <span className={painel['preco']}>
                  {vigente.planCurrentPrice
                    ? formatarDinheiro(vigente.planCurrentPrice.amountMinor, vigente.planCurrentPrice.currency)
                    : '—'}
                </span>
              </div>
              <div className={`${painel['linha']} ${painel['novo']}`}>
                <span className={painel['rotuloDaLinha']}>Para</span>
                <span className={painel['nomeDoPlano']}>{escolhido.name}</span>
                <span className={painel['preco']}>
                  {escolhido.currentPrice
                    ? formatarDinheiro(escolhido.currentPrice.amountMinor, escolhido.currentPrice.currency)
                    : '—'}
                </span>
              </div>
              {diferenca !== null && diferenca !== 0 ? (
                <p className={painel['diferenca']} data-testid="diferenca-de-preco">
                  Mensalidade {diferenca > 0 ? 'sobe' : 'cai'}{' '}
                  <output>{formatarDinheiro(Math.abs(diferenca), escolhido.currentPrice?.currency)}</output>.
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className={painel['efeitos']} data-testid="aviso-de-troca">
            <li>O plano novo vale na hora, sem proração e sem crédito.</li>
            <li>
              Vigência mantida até{' '}
              <TenantDateTime iso={vigente.endsAt} timeZone={timezone} format="date" />.
            </li>
            <li>Parcelas abertas do plano atual são canceladas e refeitas no plano novo.</li>
            <li>Parcela já paga e mês anterior em atraso não mudam.</li>
            {vigente.recorrenciaAtiva ? (
              <li data-testid="aviso-de-recorrencia">
                Este aluno tem cobrança recorrente no cartão: ela não passa para o plano novo.
                Encerre e ative de novo em “Cobrança recorrente”.
              </li>
            ) : null}
          </ul>

          {vigente.trocaAgendada ? (
            <p role="status" className={estilos['nota']} data-testid="troca-ja-agendada">
              Havia uma troca agendada
              {vigente.trocaAgendada.planName ? ` para ${vigente.trocaAgendada.planName}` : ''} em{' '}
              <TenantDateTime iso={vigente.trocaAgendada.effectiveFrom} timeZone={timezone} format="date" />.
              Trocar agora a substitui.
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
