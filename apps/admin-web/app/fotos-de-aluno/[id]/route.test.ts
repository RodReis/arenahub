import { afterEach, describe, expect, it, vi } from "vitest";

const cookieDeAcesso: { valor: string | null } = vi.hoisted(() => ({
  valor: "token-de-acesso",
}));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (nome: string) =>
        nome === "arenahub_access" && cookieDeAcesso.valor !== null
          ? { name: nome, value: cookieDeAcesso.valor }
          : undefined,
    }),
}));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";

const chamar = (id = ID) =>
  GET(new Request("http://painel/fotos-de-aluno/x") as never, {
    params: Promise.resolve({ id }),
  });

/**
 * #503 -- a foto do aluno servida pelo painel. Mesma disciplina da rota do
 * contrato: repassa SO o cookie de acesso e monta um caminho literal.
 */
describe("GET /fotos-de-aluno/[id]", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cookieDeAcesso.valor = "token-de-acesso";
  });

  it("repassa o cookie de acesso e devolve os bytes com o content-type", async () => {
    const fetchFalso = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "set-cookie": "nao=repassar",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchFalso);

    const resposta = await chamar();

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("image/jpeg");
    expect(resposta.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await resposta.arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );

    const [url, opcoes] = fetchFalso.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(new RegExp(`/api/v1/students/${ID}/photo$`));
    expect((opcoes.headers as Record<string, string>)["cookie"]).toBe(
      "arenahub_access=token-de-acesso",
    );
  });

  it("sem sessao nao chama a API -- 404", async () => {
    cookieDeAcesso.valor = null;
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    expect((await chamar()).status).toBe(404);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("codifica o id: nao vira caminho para outra rota da API", async () => {
    const fetchFalso = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    vi.stubGlobal("fetch", fetchFalso);

    await chamar("../../auth/me");

    const [url] = fetchFalso.mock.calls[0] as unknown as [string];
    expect(url).toContain("..%2F..%2Fauth%2Fme");
  });

  it("API sem foto vira 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
    );

    expect((await chamar()).status).toBe(404);
  });
});
