import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Ausente } from '../../ui/Ausente.js';
import { CardDeLista, LinhaDeLista } from '../../ui/CardDeLista.js';
import { Avatar } from '../../ui/Marca.js';
import { nomeParaExibir } from '../../ui/nome.js';
import { Indisponivel, TituloDaTela } from '../../ui/Tela.js';
import { useTema } from '../../ui/theme.js';
import { Traco, type NomeDoTraco } from '../../ui/traco.js';

/** Contrato de `GET /api/v1/mobile/perfil`. */
export interface DadosDoPerfil {
  readonly asOf: string;
  readonly nome: string;
  readonly matricula: string;
  /** `AAAA-MM-DD` */
  readonly nascimento: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly alunoDesde: string;
  readonly unidade: string;
}

export type DestinoDoPerfil = 'avisos' | 'frequencia' | 'consentimentos' | 'exportar-dados';

const ATALHOS: readonly { destino: DestinoDoPerfil; rotulo: string; traco: NomeDoTraco }[] = [
  { destino: 'avisos', rotulo: 'Meus avisos', traco: 'sino' },
  { destino: 'frequencia', rotulo: 'Minha frequência', traco: 'calendario' },
  { destino: 'consentimentos', rotulo: 'Permissões e privacidade', traco: 'escudo' },
  { destino: 'exportar-dados', rotulo: 'Exportar histórico corporal', traco: 'download' },
];

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * `11987654321` -> `(11) 98765-4321`. Mascara de exibicao (CLAUDE.md: telefone
 * sempre mascarado). Formato que nao reconhece aparece como veio -- esconder o
 * contato por nao saber mascarar seria pior.
 */
export function mascararTelefone(bruto: string): string {
  let digitos = bruto.replace(/\D/gu, '');
  if (digitos.length > 11 && digitos.startsWith('55')) digitos = digitos.slice(2);

  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;

  return bruto;
}

/**
 * Aba Perfil do App Mobile v2.
 *
 * O botao de WhatsApp e o "Editar dados" do prototipo NAO estao aqui: a
 * academia nao tem contato cadastrado para o app oferecer, e o aluno nao edita
 * cadastro pelo app -- quem corrige dado e a recepcao. Botao que nao faz nada
 * e pior que botao nenhum.
 *
 * Os atalhos para avisos, frequencia, permissoes e exportacao NAO estao no
 * prototipo e entram mesmo assim: sao funcoes que o aluno ja tinha (F24-F29), e
 * o desenho novo nao pode apaga-las.
 */
export function Perfil({
  perfil,
  plano,
  versao,
  onIr,
  onSair,
  testID,
}: {
  perfil: DadosDoPerfil | null;
  /** Nome do plano, quando ha -- vem de outra leitura. */
  plano: string | null;
  versao: string;
  onIr: (destino: DestinoDoPerfil) => void;
  onSair: () => void;
  testID?: string | undefined;
}) {
  const t = useTema();

  return (
    <View testID={testID} style={estilos.pilha}>
      <TituloDaTela>Perfil</TituloDaTela>

      {perfil === null ? (
        <Indisponivel oQue="Seu cadastro" testID="perfil-indisponivel" />
      ) : (
        <>
          <View style={[estilos.identidade, { backgroundColor: t.cor.bg.surface, borderRadius: t.radius.card + 2, borderColor: t.cor.border.hairline }]}>
            <Avatar nome={perfil.nome} tamanho={84} anel />
            <View style={estilos.centro}>
              <Text style={{ color: t.cor.text.primary, fontSize: 20, textAlign: 'center', fontFamily: t.fonte(700) }}>{nomeParaExibir(perfil.nome)}</Text>
              <Text style={{ color: t.cor.text.muted, fontSize: 12, marginTop: 2, fontFamily: t.mono }} testID="perfil-matricula">
                {perfil.matricula}
              </Text>
            </View>
            <View style={estilos.chips}>
              {[plano, perfil.unidade].filter((x): x is string => Boolean(x)).map((rotulo) => (
                <View key={rotulo} style={[estilos.chip, { backgroundColor: t.cor.bg.raised }]}>
                  <Text style={{ color: t.cor.text.secondary, fontSize: 12, fontFamily: t.fonte(600) }}>{rotulo}</Text>
                </View>
              ))}
            </View>
          </View>

          <CardDeLista titulo="Meus dados" testID="perfil-dados">
            {[
              { k: 'Nome', v: nomeParaExibir(perfil.nome) },
              { k: 'Nascimento', v: perfil.nascimento.split('-').reverse().join('/') },
              { k: 'Telefone', v: perfil.telefone === null ? null : mascararTelefone(perfil.telefone) },
              { k: 'E-mail', v: perfil.email },
              {
                k: 'Aluno desde',
                v: `${MESES_CURTOS[new Date(perfil.alunoDesde).getUTCMonth()] ?? ''}/${new Date(perfil.alunoDesde).getUTCFullYear()}`,
              },
            ].map(({ k, v }, indice) => (
              <LinhaDeLista key={k} primeira={indice === 0}>
                <Text style={{ color: t.cor.text.muted, fontSize: 13, fontFamily: t.fonte(400) }}>{k}</Text>
                <View style={estilos.valor}>
                  {v === null ? (
                    <Ausente motivo={`${k} não cadastrado`} />
                  ) : (
                    <Text numberOfLines={1} style={{ color: t.cor.text.primary, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'], fontFamily: t.fonte(500) }}>
                      {v}
                    </Text>
                  )}
                </View>
              </LinhaDeLista>
            ))}
          </CardDeLista>
        </>
      )}

      <CardDeLista testID="perfil-atalhos">
        {ATALHOS.map(({ destino, rotulo, traco }, indice) => (
          <LinhaDeLista key={destino} primeira={indice === 0} onPress={() => onIr(destino)} testID={`perfil-ir-${destino}`} accessibilityLabel={rotulo}>
            <View style={[estilos.icone, { backgroundColor: t.cor.bg.raised }]}>
              <Traco nome={traco} cor={t.cor.accent.ink} tamanho={15} />
            </View>
            <Text style={{ flex: 1, color: t.cor.text.primary, fontSize: 14, fontFamily: t.fonte(500) }}>{rotulo}</Text>
            <Traco nome="avancar" cor={t.cor.text.muted} tamanho={14} />
          </LinhaDeLista>
        ))}
      </CardDeLista>

      <Pressable
        onPress={onSair}
        accessibilityRole="button"
        testID="botao-sair"
        style={({ pressed }) => [estilos.sair, { borderRadius: t.radius.control, backgroundColor: pressed ? t.cor.bg.surface : 'transparent' }]}
      >
        <Text style={{ color: t.cor.state.err, fontSize: 14, fontFamily: t.fonte(600) }}>Sair da conta</Text>
      </Pressable>

      <Text style={{ color: t.cor.text.muted, fontSize: 12, textAlign: 'center', fontFamily: t.fonte(400) }}>
        {`v${versao} · tecnologia arenahub`}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  pilha: {
    gap: 14,
  },
  identidade: {
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  centro: {
    alignItems: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 999,
    justifyContent: 'center',
  },
  valor: {
    flex: 1,
    alignItems: 'flex-end',
  },
  icone: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sair: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
