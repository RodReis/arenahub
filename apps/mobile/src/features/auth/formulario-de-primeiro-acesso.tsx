import { useState } from 'react';
import { Text, View } from 'react-native';

import { Badge } from '../../ui/Badge.js';
import { Botao } from '../../ui/Botao.js';
import { Campo } from '../../ui/Campo.js';
import { Check } from '../../ui/icones.js';
import { useTema } from '../../ui/theme.js';
import { dataNascimentoParaIso, mascararCpf, mascararDataNascimento } from '../../lib/mascaras.js';

/** Dados da tela de confirmacao (SPEC-071 §6.3), devolvidos pela consulta. */
export interface AtivacaoEncontrada {
  readonly nomeCompleto: string;
  readonly cpfFormatado: string;
  readonly dataNascimento: string;
  readonly plano: string;
  readonly local: string;
  readonly dataInicio: string;
  readonly activationRef: string;
}

/** `2026-01-05` -> `05/01/2026`. So para exibicao -- o corpo da API usa ISO. */
function paraExibicao(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Primeiro acesso self-service -- SPEC-071 §6.2/§6.3, issue #333.
 *
 * DOIS PASSOS: CPF + nascimento so CONSULTAM (§6.2, `POST .../activation/lookup`)
 * -- nao abrem sessao, nao autenticam. Achado o aluno, a tela mostra o selo
 * "Cadastro encontrado", o nome e os 5 campos formatados (§6.3), e libera
 * senha + confirmacao; so `POST .../activation/self-service`, com o
 * `activationRef` desta consulta, autentica de fato.
 *
 * NAO ENCONTRADO -- uma unica mensagem generica, pedindo para procurar a
 * administracao, sem distinguir CPF errado de nascimento errado de conta ja
 * ativa (§6.4): mesmo padrao antienumeracao do login (`M4-FR-002`), risco de
 * enumeracao com CPF + nascimento aceito pelo PI sem throttling nesta fatia
 * (ADR-057, Decisao 2).
 */
export function FormularioDePrimeiroAcesso({
  onConsultar,
  onCriarSenha,
  testID,
}: {
  onConsultar: (dados: { cpf: string; dataNascimento: string }) => Promise<AtivacaoEncontrada>;
  onCriarSenha: (dados: { activationRef: string; senha: string; confirmacaoSenha: string }) => Promise<void>;
  testID?: string | undefined;
}) {
  const t = useTema();
  const [cpfMascarado, setCpfMascarado] = useState('');
  const [dataMascarada, setDataMascarada] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [erroDaConsulta, setErroDaConsulta] = useState<string | null>(null);

  const [encontrado, setEncontrado] = useState<AtivacaoEncontrada | null>(null);
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erroDaSenha, setErroDaSenha] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const cpf = cpfMascarado.replace(/\D/g, '');
  const dataIso = dataNascimentoParaIso(dataMascarada);

  const consultar = () => {
    if (consultando || cpf.length !== 11 || !dataIso) return;

    setErroDaConsulta(null);
    setConsultando(true);

    void onConsultar({ cpf, dataNascimento: dataIso })
      .then(setEncontrado)
      .catch(() => {
        setErroDaConsulta('Não encontramos seu cadastro. Procure a administração da academia.');
      })
      .finally(() => setConsultando(false));
  };

  const criarSenha = () => {
    if (criando || !encontrado) return;

    // Piso de 10 caracteres -- a mesma politica de senha do convite por
    // e-mail (`app/ativar.tsx`, `SenhaFracaError` no servico). O protótipo
    // (§6.3) fala em 6, mas o servidor recusa abaixo de 10 -- o texto segue
    // a regra que de fato vale, para nao pedir uma senha que a API rejeita.
    if (senha.length < 10) {
      setErroDaSenha('A senha precisa de pelo menos 10 caracteres.');
      return;
    }
    if (senha !== confirmacao) {
      setErroDaSenha('As senhas não são iguais.');
      return;
    }

    setErroDaSenha(null);
    setCriando(true);

    void onCriarSenha({
      activationRef: encontrado.activationRef,
      senha,
      confirmacaoSenha: confirmacao,
    }).catch(() => {
      setErroDaSenha('Não foi possível criar sua senha. Tente de novo.');
      setCriando(false);
    });
  };

  if (encontrado) {
    const linhas: readonly { rotulo: string; valor: string }[] = [
      { rotulo: 'CPF', valor: encontrado.cpfFormatado },
      { rotulo: 'DATA DE NASCIMENTO', valor: paraExibicao(encontrado.dataNascimento) },
      { rotulo: 'PLANO', valor: encontrado.plano },
      { rotulo: 'LOCAL', valor: encontrado.local },
      { rotulo: 'DATA DE INÍCIO', valor: paraExibicao(encontrado.dataInicio) },
    ];

    return (
      <View testID={testID} style={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Badge tom="ok" texto="Cadastro encontrado" icone={<Check tom="ok" tamanho={13} />} />
          <Text
            accessibilityRole="header"
            style={{ color: t.cor.text.primary, fontSize: 18, fontFamily: t.fonte(700) }}
          >
            {encontrado.nomeCompleto}
          </Text>
        </View>

        <View style={{ gap: 8 }}>
          {linhas.map((linha) => (
            <View
              key={linha.rotulo}
              style={{ flexDirection: 'row', justifyContent: 'space-between' }}
            >
              <Text style={{ color: t.cor.text.muted, fontSize: 11, letterSpacing: 0.5, fontFamily: t.fonte(600) }}>
                {linha.rotulo}
              </Text>
              <Text
                style={{
                  color: t.cor.text.primary,
                  fontSize: 13,
                  fontVariant: ['tabular-nums'],
                  fontFamily: t.fonte(500),
                }}
              >
                {linha.valor}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: t.cor.text.primary, fontSize: 15, fontFamily: t.fonte(700) }}>
            Crie sua senha
          </Text>

          <Campo
            testID="campo-nova-senha"
            rotulo="Nova senha"
            value={senha}
            onChangeText={setSenha}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
          />

          <Campo
            testID="campo-confirmacao-senha"
            rotulo="Confirmar senha"
            value={confirmacao}
            onChangeText={setConfirmacao}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={criarSenha}
            {...(erroDaSenha ? { erro: erroDaSenha } : {})}
          />

          <Text style={{ color: t.cor.text.muted, fontSize: 12, lineHeight: 16, fontFamily: t.fonte(400) }}>
            Use ao menos 10 caracteres. Você vai usar esta senha junto com seu CPF para entrar.
          </Text>
        </View>

        <Botao
          titulo="Criar senha e entrar"
          onPress={criarSenha}
          carregando={criando}
          testID="botao-criar-senha"
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={{ gap: 14 }}>
      <Text style={{ color: t.cor.text.secondary, fontSize: 13, lineHeight: 18, fontFamily: t.fonte(400) }}>
        Confirme seus dados de matrícula para criar sua senha de acesso.
      </Text>

      <Campo
        testID="campo-cpf-primeiro-acesso"
        rotulo="CPF"
        value={cpfMascarado}
        onChangeText={(digitado) => setCpfMascarado(mascararCpf(digitado))}
        placeholder="000.000.000-00"
        keyboardType="number-pad"
        returnKeyType="next"
      />

      <Campo
        testID="campo-nascimento-primeiro-acesso"
        rotulo="Data de nascimento"
        value={dataMascarada}
        onChangeText={(digitado) => setDataMascarada(mascararDataNascimento(digitado))}
        placeholder="DD/MM/AAAA"
        keyboardType="number-pad"
        returnKeyType="go"
        onSubmitEditing={consultar}
      />

      {erroDaConsulta ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: t.cor.state.err,
            fontFamily: t.fonte(500),
            fontSize: t.type.body.size,
            lineHeight: t.type.body.lineHeight,
          }}
        >
          {erroDaConsulta}
        </Text>
      ) : null}

      <Botao
        titulo="Consultar meu cadastro"
        onPress={consultar}
        carregando={consultando}
        desabilitado={cpf.length !== 11 || !dataIso}
        testID="botao-consultar-primeiro-acesso"
      />

      <Text style={{ color: t.cor.text.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', fontFamily: t.fonte(400) }}>
        Consultamos o CPF no cadastro da academia. Nada é criado sem confirmação dos seus dados.
      </Text>
    </View>
  );
}
