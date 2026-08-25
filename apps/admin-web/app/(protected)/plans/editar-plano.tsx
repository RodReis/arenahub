'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from './planos.module.css';

import { editarPlano, type EstadoDaEdicaoDePlano } from '../../actions/membership';

interface Unidade {
  id: string;
  name: string;
}

interface Janela {
  gymUnitId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface Props {
  readonly planId: string;
  readonly nome: string;
  readonly descricao: string | null;
  readonly unidadesDoPlano: readonly string[];
  readonly janelas: readonly Janela[];
  readonly unidades: readonly Unidade[];
}

interface LinhaDeJanela {
  chave: number;
  unidade: string;
  dia: string;
  inicio: string;
  fim: string;
}

const ESTADO_INICIAL: EstadoDaEdicaoDePlano = {};

/*
 * `valor` é o eixo do motor de decisão: 0 = domingo ... 6 = sábado (#129).
 * A ordem de exibição começa na segunda porque é assim que a recepção lê uma
 * grade de horário.
 */
const DIAS = [
  { valor: '1', rotulo: 'Segunda' },
  { valor: '2', rotulo: 'Terça' },
  { valor: '3', rotulo: 'Quarta' },
  { valor: '4', rotulo: 'Quinta' },
  { valor: '5', rotulo: 'Sexta' },
  { valor: '6', rotulo: 'Sábado' },
  { valor: '0', rotulo: 'Domingo' },
];

/** `1080` → `"18:00"`. Unidade da API, formato do input `time`. */
function horaDoMinuto(minuto: number): string {
  const hora = Math.floor(minuto / 60);
  const resto = minuto % 60;

  return `${String(hora).padStart(2, '0')}:${String(resto).padStart(2, '0')}`;
}

function BotaoDeEdicao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-edicao-do-plano">
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

/**
 * Edição de plano — nada disso era editável até 24/08/2026.
 *
 * O plano nascia e ficava: nome errado, descrição desatualizada e, o pior,
 * unidade faltando. Plano sem unidade não libera acesso em lugar nenhum, e a
 * única saída era criar outro plano e migrar os alunos na mão.
 *
 * PREÇO NÃO ESTÁ AQUI: tem o botão "Reajustar" ao lado, com histórico de
 * vigência. Misturar os dois apagaria a linha do tempo do preço.
 */
export function EditarPlano({
  planId,
  nome,
  descricao,
  unidadesDoPlano,
  janelas,
  unidades,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(editarPlano, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', `erro-da-edicao-do-plano-${planId}`);
  useToastDeErro(
    estado.sucesso ? 'Plano atualizado.' : undefined,
    'info',
    `sucesso-da-edicao-do-plano-${planId}`,
  );

  /*
   * As janelas viram linhas editáveis. `key` própria porque `dayOfWeek` se
   * repete: dois horários no mesmo dia são caso real (manhã e noite).
   */
  const [linhas, setLinhas] = useState<LinhaDeJanela[]>(() =>
    janelas.length > 0
      ? janelas.map((janela, indice) => ({
          chave: indice + 1,
          unidade: janela.gymUnitId,
          dia: String(janela.dayOfWeek),
          inicio: horaDoMinuto(janela.startMinute),
          fim: horaDoMinuto(janela.endMinute),
        }))
      : [
          {
            chave: 1,
            unidade: unidades[0]?.id ?? '',
            dia: '1',
            inicio: '06:00',
            fim: '22:00',
          },
        ],
  );

  const [proximaChave, setProximaChave] = useState(janelas.length + 1);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    // `showModal()` traz foco preso e backdrop -- `open` sozinho não traz.
    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    const aoFechar = (): void => setAberto(false);
    elemento.addEventListener('close', aoFechar);

    return () => elemento.removeEventListener('close', aoFechar);
  }, []);

  useEffect(() => {
    if (estado.sucesso) setAberto(false);
  }, [estado.sucesso]);

  const adicionar = (): void => {
    setLinhas([
      ...linhas,
      {
        chave: proximaChave,
        unidade: unidades[0]?.id ?? '',
        dia: '1',
        inicio: '06:00',
        fim: '22:00',
      },
    ]);
    setProximaChave(proximaChave + 1);
  };

  const remover = (chave: number): void => {
    setLinhas(linhas.filter((linha) => linha.chave !== chave));
  };

  const alterar = (chave: number, campo: keyof LinhaDeJanela, valor: string): void => {
    setLinhas(linhas.map((linha) => (linha.chave === chave ? { ...linha, [campo]: valor } : linha)));
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`abrir-edicao-do-plano-${planId}`}
      >
        Editar
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogoLargo']}
        aria-labelledby={`titulo-edicao-plano-${planId}`}
      >
        <form className={estilos['formulario']} action={acao}>
          <input type="hidden" name="planId" value={planId} />

          <div className={estilos['cabecalho']}>
            <h2 className={estilos['titulo']} id={`titulo-edicao-plano-${planId}`}>
              Editar plano
            </h2>
            <p className={estilos['nomeDoPlano']}>{nome}</p>
          </div>

          <div className={estilos['corpo']}>
            <Field
              id={`edicao-nome-plano-${planId}`}
              name="name"
              label="Nome do plano"
              defaultValue={estado.valores?.name ?? nome}
              maxLength={120}
              required
              data-testid="campo-edicao-nome-do-plano"
            />

            <TextareaField
              id={`edicao-descricao-plano-${planId}`}
              name="description"
              label="Descrição"
              defaultValue={estado.valores?.description ?? descricao ?? ''}
              rows={2}
              maxLength={500}
              data-testid="campo-edicao-descricao-do-plano"
            />

            <fieldset className={estilos['grupo']}>
              <legend>Unidades onde o plano vale</legend>

              {unidades.map((unidade) => (
                <label key={unidade.id} className={estilos['marcador']}>
                  <input
                    type="checkbox"
                    name="gymUnitIds"
                    value={unidade.id}
                    defaultChecked={unidadesDoPlano.includes(unidade.id)}
                    data-testid={`edicao-unidade-${unidade.id}`}
                  />
                  {unidade.name}
                </label>
              ))}
            </fieldset>

            <fieldset className={estilos['grupo']}>
              <legend>Janelas de horário</legend>

              <p role="note" className={estilos['notaDoDialogo']}>
                O acesso vale só dentro destas janelas. Use 24:00 para indicar o fim do dia.
              </p>

              <table className={estilos['janelas']}>
                <thead>
                  <tr>
                    <th scope="col">Unidade</th>
                    <th scope="col">Dia</th>
                    <th scope="col">Início</th>
                    <th scope="col">Fim</th>
                    <th scope="col">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha) => (
                    <tr key={linha.chave}>
                      <td>
                        <select
                          name="janelaUnidade"
                          value={linha.unidade}
                          onChange={(evento) => alterar(linha.chave, 'unidade', evento.target.value)}
                          aria-label="Unidade da janela"
                        >
                          {unidades.map((unidade) => (
                            <option key={unidade.id} value={unidade.id}>
                              {unidade.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          name="janelaDia"
                          value={linha.dia}
                          onChange={(evento) => alterar(linha.chave, 'dia', evento.target.value)}
                          aria-label="Dia da semana"
                        >
                          {DIAS.map((dia) => (
                            <option key={dia.valor} value={dia.valor}>
                              {dia.rotulo}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="time"
                          name="janelaInicio"
                          value={linha.inicio}
                          onChange={(evento) => alterar(linha.chave, 'inicio', evento.target.value)}
                          aria-label="Hora de início"
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          name="janelaFim"
                          value={linha.fim}
                          onChange={(evento) => alterar(linha.chave, 'fim', evento.target.value)}
                          aria-label="Hora de fim"
                        />
                      </td>
                      <td>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => remover(linha.chave)}
                          disabled={linhas.length === 1}
                        >
                          Remover
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Button type="button" variant="outline" onClick={adicionar}>
                Adicionar janela
              </Button>
            </fieldset>

            {/*
              QUEM JÁ TEM ASSINATURA NÃO É AFETADO: o direito de acesso guarda
              um SNAPSHOT da política, copiado quando nasce. Dizer isso evita
              a recepção achar que corrigiu o acesso de quem já está dentro --
              e sair procurando por que a catraca não mudou.
            */}
            <p role="note" className={estilos['notaDoDialogo']}>
              A alteração vale para assinaturas novas. Quem já tem plano mantém o acesso que
              recebeu — para mudar, use “Alterar plano” na ficha do aluno.
            </p>

            {/* O preço tem rota própria, com histórico. Ver o botão ao lado. */}
            <p role="note" className={estilos['notaDoDialogo']}>
              O preço não muda aqui — use “Reajustar”, que registra a vigência.
            </p>
          </div>

          <div className={estilos['rodape']}>
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
