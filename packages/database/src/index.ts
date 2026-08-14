/**
 * Ponto de entrada do pacote de banco.
 *
 * Exporta a factory do client e o tipo gerado. Nenhum repositorio, nenhum
 * caso de uso e nenhuma entidade -- isso e escopo das fatias, nao do
 * bootstrap.
 *
 * REGRA DE ARQUITETURA No 2, para quando a primeira entidade chegar:
 * repositorio recebe `TenantContext` obrigatorio, e o tenant vem da
 * identidade autenticada -- nunca do corpo da requisicao nem do payload de
 * webhook. Este arquivo nao pode dificultar isso; por enquanto so nao
 * atrapalha.
 */
export { criarPrismaClient, type PrismaClientArenaHub } from './client.js';
