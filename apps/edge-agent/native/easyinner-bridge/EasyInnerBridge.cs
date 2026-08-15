using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization; // System.Web.Extensions

/// <summary>
/// Ponte entre o edge-agent (Node) e a EasyInner.dll da Topdata.
///
/// A DLL e Windows x86, binaria e NAO thread-safe. Este processo a carrega e
/// expoe o contrato PonteEasyInner por stdio: uma linha JSON de comando entra
/// por stdin, uma linha JSON de resposta sai por stdout.
///
/// Uma UNICA thread (o worker) chama a DLL -- exigencia do manual
/// (docs/vendor/topdata/PROTOCOLO-CATRACA.md). stdin so enfileira; o worker
/// serializa.
///
/// Compilar x86: build.ps1 (csc /platform:x86). Um processo x64 carregando a
/// DLL de 32 bits retorna GPF (8).
/// </summary>
class EasyInnerBridge {
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte DefinirTipoConexao(byte Tipo);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte AbrirPortaComunicacao(int Porta);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern void FecharPortaComunicacao();
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte ConfigurarInnerOnLine();
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte HabilitarMudancaOnLineOffLine(byte Habilita, byte Tempo);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaEntrada(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaSaida(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaDoisSentidos(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaEntradaInvertida(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte LiberarCatracaSaidaInvertida(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte PingOnLine(int Inner);
    [DllImport("EasyInner.dll", CallingConvention = CallingConvention.Winapi)]
    static extern byte ReceberDadosOnLine(int Inner, ref byte Origem, ref byte Complemento,
        StringBuilder Cartao, ref byte Dia, ref byte Mes, ref byte Ano,
        ref byte Hora, ref byte Minuto, ref byte Segundo);

    static readonly JavaScriptSerializer J = new JavaScriptSerializer();
    static readonly BlockingCollection<string> fila = new BlockingCollection<string>();
    static System.IO.TextWriter saida;

    static void Main() {
        saida = Console.Out;

        var worker = new Thread(Worker) { IsBackground = true };
        worker.Start();

        string entrada;
        while ((entrada = Console.In.ReadLine()) != null) {
            if (entrada.Trim().Length == 0) continue;
            fila.Add(entrada);
        }
        fila.CompleteAdding();
        try { FecharPortaComunicacao(); } catch { }
    }

    static void Worker() {
        foreach (var linha in fila.GetConsumingEnumerable()) {
            string resp;
            try { resp = Tratar(linha); }
            catch (Exception e) { resp = Falha(e.Message); }
            lock (saida) { saida.Write(resp + "\n"); saida.Flush(); }
        }
    }

    static string Falha(string msg) {
        return J.Serialize(new Dictionary<string, object> {
            { "tipo", "falha-da-ponte" }, { "mensagem", msg }
        });
    }

    static string Retorno(byte r) {
        return J.Serialize(new Dictionary<string, object> {
            { "tipo", "retorno" }, { "retorno", (int)r }
        });
    }

    static string Tratar(string linha) {
        var cmd = (IDictionary<string, object>)J.DeserializeObject(linha);
        string nome = Convert.ToString(cmd["cmd"]);
        int inner = cmd.ContainsKey("inner") ? Convert.ToInt32(cmd["inner"]) : 0;

        switch (nome) {
            case "conectar":       return Conectar(cmd);
            case "testar-conexao": return Retorno(ConfigurarInnerOnLine());
            case "ping":           return Retorno(PingOnLine(inner));
            case "liberar":        return Liberar(cmd, inner);
            case "receber-evento": return Receber(inner);
            default:               return Falha("comando desconhecido: " + nome);
        }
    }

    /// <summary>
    /// Setup da conexao (fora do contrato de 4 comandos do lado Node; chamado
    /// na inicializacao). DefinirTipoConexao(2)=TCP porta fixa; abre a porta;
    /// habilita modo online com ping. Retorna o PIOR codigo dos tres.
    /// </summary>
    static string Conectar(IDictionary<string, object> cmd) {
        int porta = cmd.ContainsKey("porta") ? Convert.ToInt32(cmd["porta"]) : 3570;
        byte tempo = cmd.ContainsKey("tempo") ? Convert.ToByte(cmd["tempo"]) : (byte)10;
        byte r1 = DefinirTipoConexao(2);
        byte r2 = AbrirPortaComunicacao(porta);
        byte r3 = HabilitarMudancaOnLineOffLine(2, tempo);
        byte pior = Math.Max(r1, Math.Max(r2, r3));
        return Retorno(pior);
    }

    static string Liberar(IDictionary<string, object> cmd, int inner) {
        string sentido = Convert.ToString(cmd["sentido"]);
        bool inv = cmd.ContainsKey("invertido") && Convert.ToBoolean(cmd["invertido"]);
        byte r;
        if (sentido == "entrada")     r = inv ? LiberarCatracaEntradaInvertida(inner) : LiberarCatracaEntrada(inner);
        else if (sentido == "saida")  r = inv ? LiberarCatracaSaidaInvertida(inner)   : LiberarCatracaSaida(inner);
        else                          r = LiberarCatracaDoisSentidos(inner);
        return Retorno(r);
    }

    /// <summary>
    /// Le um evento (bloqueante do lado da DLL). Retorno != 0 = sem evento no
    /// prazo. Origem 6 = giro; 5 = fim de tempo. A DLL entrega data em campos
    /// separados; junta em ISO local.
    /// </summary>
    static string Receber(int inner) {
        byte origem = 0, comp = 0, dia = 0, mes = 0, ano = 0, hora = 0, min = 0, seg = 0;
        var cartao = new StringBuilder(64);
        byte r = ReceberDadosOnLine(inner, ref origem, ref comp, cartao,
            ref dia, ref mes, ref ano, ref hora, ref min, ref seg);

        if (r != 0) {
            return J.Serialize(new Dictionary<string, object> { { "tipo", "sem-evento" } });
        }

        string ocorrido = string.Format("20{0:D2}-{1:D2}-{2:D2}T{3:D2}:{4:D2}:{5:D2}",
            ano, mes, dia, hora, min, seg);

        var evento = new Dictionary<string, object> {
            { "origem", (int)origem },
            { "complemento", (int)comp },
            { "cartao", cartao.ToString() },
            { "ocorridoEm", ocorrido }
        };
        return J.Serialize(new Dictionary<string, object> {
            { "tipo", "evento" }, { "evento", evento }
        });
    }
}
