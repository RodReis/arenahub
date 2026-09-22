/**
 * Rótulos pt-BR dos perfis de acesso — F80.
 *
 * `Role.name` é identificador de domínio e fica em inglês (`CLAUDE.md`,
 * *Regras de trabalho*); quem administra a academia lê "Recepção", nunca
 * `RECEPTION`. O mapa vive AQUI, num lugar só: repetido por tela, o dia em que
 * um perfil for renomeado deixaria metade da interface falando o nome antigo.
 *
 * A DESCRIÇÃO NÃO É ENFEITE. Quem convida escolhe o perfil de alguém que ainda
 * não entrou, e o nome sozinho não diz o que muda: "Recepção" e "Financeiro"
 * soam igualmente plausíveis para quem vai mexer com mensalidade. A frase diz
 * o recorte em uma linha, e é o que evita dar o painel financeiro inteiro a
 * quem só precisa achar a fatura de um aluno no balcão.
 */

export interface RotuloDePerfil {
  readonly label: string;
  readonly descricao: string;
}

export const ROTULO_DE_PERFIL: Readonly<Record<string, RotuloDePerfil>> = {
  OWNER: {
    label: 'Dono',
    descricao: 'Acesso total, incluindo a equipe e o cadastro da academia.',
  },
  MANAGER: {
    label: 'Gerente',
    descricao: 'A operação inteira, menos gerenciar quem tem acesso.',
  },
  FINANCE: {
    label: 'Financeiro',
    descricao: 'Planos, cobrança, conciliação e o painel financeiro.',
  },
  RECEPTION: {
    label: 'Recepção',
    descricao: 'Balcão: aluno, biometria, grade de aulas e a fatura de cada um.',
  },
  TRAINER: {
    label: 'Professor',
    descricao: 'Aulas, ficha do aluno e avaliação física.',
  },
};

/**
 * O nome que aparece na tela.
 *
 * DEVOLVE O CÓDIGO CRU quando o papel não está no mapa, e isso é deliberado:
 * um tenant pode ter papel herdado de antes da F80, e mostrar o código é
 * melhor que mostrar vazio — quem vê `SUPERVISOR` entende que existe um papel
 * que a tela não conhece; quem vê um traço acha que a pessoa não tem perfil.
 */
export function rotuloDePerfil(nome: string): string {
  return ROTULO_DE_PERFIL[nome]?.label ?? nome;
}

/**
 * A ordem em que os perfis aparecem no combo: do mais amplo ao mais estreito.
 *
 * `GET /roles` ordena por `name`, que e o codigo em INGLES -- e em portugues
 * isso produz "Financeiro, Gerente, Dono, Recepcao, Professor", uma sequencia
 * sem logica nenhuma que ainda por cima deixa "Financeiro" como padrao do
 * combo. Quem convide sem prestar atencao daria o painel financeiro a
 * recepcao.
 *
 * Papel fora do mapa vai para o fim, e nao para o comeco: perfil herdado de
 * antes da F80 e excecao, nao a primeira escolha.
 */
const ORDEM: readonly string[] = ['OWNER', 'MANAGER', 'FINANCE', 'RECEPTION', 'TRAINER'];

export function ordenarPerfis<T extends { name: string }>(papeis: readonly T[]): T[] {
  const posicao = (nome: string): number => {
    const indice = ORDEM.indexOf(nome);

    return indice === -1 ? ORDEM.length : indice;
  };

  return [...papeis].sort((a, b) => posicao(a.name) - posicao(b.name) || a.name.localeCompare(b.name));
}
