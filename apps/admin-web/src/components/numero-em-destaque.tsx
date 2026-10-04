'use client';

import { Button, useToast } from '@arenahub/ui';

import estilos from './numero-em-destaque.module.css';

interface Props {
  readonly numero: string;
  /**
   * Resultado do vinculo com o leitor. Ausente quando a tela so MOSTRA o
   * numero (ficha) e nao sabe o estado do leitor -- ai nao promete nada.
   */
  readonly vinculado?: boolean;
}

/** Blocos de 3 a partir da DIREITA: 100 000 000 007, e o legado curto 1 491. */
function emBlocos(numero: string): string[] {
  return numero.match(/.{1,3}(?=(.{3})*$)/g) ?? [numero];
}

/**
 * O numero da catraca como VISOR, nao como dado de tabela -- spec
 * 2026-10-03, pedido do PI: grande, em destaque, com cor, borda e efeito.
 *
 * A recepcao le este numero na tela e o DIGITA no teclado do leitor facial
 * com o aluno esperando. Por isso: mono grande, blocos de tres (o olho perde
 * a posicao num corrido de doze digitos), e copia que leva SO os digitos --
 * os espacos sao `gap` de CSS entre `<span>`s, nao texto.
 */
export function NumeroEmDestaque({ numero, vinculado }: Props) {
  const { show } = useToast();

  const avisarFalha = (): void =>
    show('warn', 'Não foi possível copiar. Selecione o número e copie manualmente.');

  /*
   * Painel aberto por http://192.168.x.x no balcao NAO e contexto seguro:
   * `navigator.clipboard` e `undefined` e `.writeText` estouraria FORA do
   * `.catch` da promise -- clique mudo. Por isso o try e o `?.`.
   */
  const copiar = async (): Promise<void> => {
    try {
      const escrever = navigator.clipboard?.writeText.bind(navigator.clipboard);
      if (escrever === undefined) {
        avisarFalha();
        return;
      }
      await escrever(numero);
      show('info', 'Número copiado', 'numero-copiado');
    } catch {
      avisarFalha();
    }
  };

  return (
    <div className={estilos['placa']} data-testid="numero-em-destaque">
      <p className={estilos['rotulo']}>Número da catraca</p>

      <output className={estilos['numero']} data-testid="numero-em-destaque-valor">
        {emBlocos(numero).map((bloco, indice) => (
          // A posicao E a identidade do bloco: o numero nao reordena.
          <span key={indice}>{bloco}</span>
        ))}
      </output>

      <div className={estilos['rodape']}>
        {vinculado === undefined ? null : (
          <p className={estilos['situacao']} data-vinculado={vinculado}>
            {vinculado
              ? 'Este número já está vinculado ao leitor.'
              : 'Agora cadastre a face no leitor com este número.'}
          </p>
        )}
        <Button type="button" variant="outline" onClick={() => void copiar()}>
          Copiar número
        </Button>
      </div>
    </div>
  );
}
