'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { FcKey } from 'react-icons/fc';

import { Button, Field, Tabs, useToastDeErro } from '@arenahub/ui';

import { NumeroEmDestaque } from '@/components/numero-em-destaque';

import {
  gerarNumeroDaCatraca,
  listarNumerosDoLeitorSemAluno,
  type EstadoDoNumero,
  type NumeroDoLeitor,
} from '../../actions/numero-da-catraca';
import dialogo from '../dialogo.module.css';
import estilos from './numero-da-catraca.module.css';

const ESTADO_INICIAL: EstadoDoNumero = {};

interface OpcaoDoLeitor {
  readonly chave: string;
  readonly numero: string;
  readonly nome: string | null;
}

/**
 * O que a lista "Do leitor" mostra -- decisoes do controlador da spec
 * 2026-10-03:
 *
 * - item que nao e `^\d{1,12}$` SAI: a API responderia 400 e a recepcao
 *   ficaria num beco sem saida;
 * - o mesmo numero em dois leitores aparece UMA vez (primeiro nome achado);
 * - o nome vem do leitor, texto nao confiavel: so texto puro (escape do
 *   React), quebras e espacos repetidos viram um espaco.
 */
export function opcoesDoLeitor(lista: readonly NumeroDoLeitor[]): OpcaoDoLeitor[] {
  const porNumero = new Map<string, OpcaoDoLeitor>();

  for (const item of lista) {
    if (!/^\d{1,12}$/.test(item.externalId)) continue;

    const nome = item.readerName?.replace(/\s+/g, ' ').trim() || null;
    const existente = porNumero.get(item.externalId);

    if (existente === undefined) {
      porNumero.set(item.externalId, {
        chave: `${item.externalId}:${item.deviceSerial}`,
        numero: item.externalId,
        nome,
      });
    } else if (existente.nome === null && nome !== null) {
      porNumero.set(item.externalId, { ...existente, nome });
    }
  }

  return [...porNumero.values()];
}

function BotaoDeEnvio({ children, testId }: { readonly children: string; readonly testId: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid={testId}>
      {pending ? 'Aguarde…' : children}
    </Button>
  );
}

/**
 * Acao de linha "Numero da catraca" (spec 2026-10-03): gera o numero do
 * aluno ou usa um que o leitor ja guarda, e a API vincula na hora.
 *
 * `<dialog>` NATIVO com `showModal()` (padrao de `qr-ampliavel.tsx`): foco
 * preso, `Esc` fecha, backdrop de graca.
 */
export function NumeroDaCatraca({ studentId }: { readonly studentId: string }) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(gerarNumeroDaCatraca, ESTADO_INICIAL);
  const [numeros, setNumeros] = useState<OpcaoDoLeitor[] | null>(null);
  const [carregando, iniciar] = useTransition();
  const [busca, setBusca] = useState('');
  const elemento = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', 'erro-numero-catraca');

  useEffect(() => {
    const atual = elemento.current;
    if (!atual) return;

    if (aberto && !atual.open) atual.showModal();
    if (!aberto && atual.open) atual.close();
  }, [aberto]);

  useEffect(() => {
    const atual = elemento.current;
    if (!atual) return;

    const aoFechar = (): void => setAberto(false);
    atual.addEventListener('close', aoFechar);

    return () => atual.removeEventListener('close', aoFechar);
  }, []);

  // Carrega a lista do leitor a cada abertura: outro aluno pode ter levado
  // um numero desde a ultima vez.
  useEffect(() => {
    if (!aberto) return;

    iniciar(async () => {
      setNumeros(opcoesDoLeitor(await listarNumerosDoLeitorSemAluno()));
    });
  }, [aberto]);

  const termo = busca.trim().toLowerCase();
  const filtrados = (numeros ?? []).filter(
    (o) => termo === '' || o.numero.includes(termo) || (o.nome?.toLowerCase().includes(termo) ?? false),
  );

  const abaGerar = (
    <form action={acao} className={estilos['aba']}>
      <input type="hidden" name="studentId" value={studentId} />
      <p className={dialogo['notaDoDialogo']}>
        Se o aluno já tem número, ele aparece aqui — nenhum outro é criado.
      </p>
      <div>
        <BotaoDeEnvio testId="gerar-numero-catraca">Mostrar ou gerar número</BotaoDeEnvio>
      </div>
    </form>
  );

  const abaLeitor = (
    <form action={acao} className={estilos['aba']}>
      <input type="hidden" name="studentId" value={studentId} />
      <Field
        id={`busca-numero-leitor-${studentId}`}
        type="search"
        label="Buscar número ou nome"
        value={busca}
        onChange={(evento) => setBusca(evento.target.value)}
        autoComplete="off"
        data-testid="busca-numero-leitor"
      />

      {numeros === null || carregando ? (
        <p className={dialogo['notaDoDialogo']}>Carregando números do leitor…</p>
      ) : filtrados.length === 0 ? (
        <p className={dialogo['notaDoDialogo']} data-testid="sem-numeros-do-leitor">
          {numeros.length === 0
            ? 'Nenhum número do leitor está livre. Use “Gerar novo”.'
            : 'Nenhum número corresponde à busca.'}
        </p>
      ) : (
        <fieldset className={estilos['lista']} data-testid="numeros-do-leitor">
          <legend className={estilos['legenda']}>Números no leitor sem aluno</legend>
          {filtrados.map((opcao) => (
            <label key={opcao.chave} className={estilos['opcao']}>
              <input type="radio" name="externalId" value={opcao.numero} required />
              <span className={estilos['numeroDaOpcao']}>{opcao.numero}</span>{' '}
              {opcao.nome === null ? null : (
                <span className={estilos['nomeDaOpcao']} title={opcao.nome}>
                  — {opcao.nome}
                </span>
              )}
            </label>
          ))}
        </fieldset>
      )}

      <div>
        <BotaoDeEnvio testId="usar-numero-do-leitor">Usar este número</BotaoDeEnvio>
      </div>
    </form>
  );

  return (
    <>
      <Button
        variant="icon"
        onClick={() => setAberto(true)}
        aria-label="Número da catraca"
        title="Número da catraca"
        data-testid={`acao-numero-catraca-${studentId}`}
      >
        <FcKey size={22} aria-hidden />
      </Button>

      <dialog
        ref={elemento}
        className={dialogo['dialogo']}
        aria-labelledby={`titulo-numero-catraca-${studentId}`}
        data-testid="dialogo-numero-catraca"
        onClick={(evento) => {
          if (evento.target === evento.currentTarget) setAberto(false);
        }}
      >
        <div className={dialogo['cabecalhoDoDialogo']}>
          <h2 id={`titulo-numero-catraca-${studentId}`} className={dialogo['tituloDoDialogo']}>
            Número da catraca
          </h2>
        </div>

        <div className={dialogo['corpoDoDialogo']}>
          {estado.numero === undefined ? null : (
            <NumeroEmDestaque numero={estado.numero} vinculado={estado.vinculado ?? false} />
          )}

          <Tabs
            label="Origem do número"
            abas={[
              { id: 'gerar', label: 'Gerar novo', content: abaGerar },
              { id: 'leitor', label: 'Do leitor', content: abaLeitor },
            ]}
          />
        </div>

        <div className={dialogo['rodapeDoDialogo']}>
          <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
            Fechar
          </Button>
        </div>
      </dialog>
    </>
  );
}
