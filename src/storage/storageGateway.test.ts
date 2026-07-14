import { loadStateWithRetry } from "./storageGateway";

describe("storage gateway", () => {
  it("relance une lecture locale qui ne répond pas", async () => {
    let calls = 0;
    const result = await loadStateWithRetry(async () => {
      calls += 1;
      if (calls === 1) return new Promise<string>(() => undefined);
      return "restored";
    }, 1);

    expect(result).toBe("restored");
    expect(calls).toBe(2);
  });

  it("ne relance pas une erreur explicite", async () => {
    const load = vi.fn().mockRejectedValue(new Error("invalid document"));

    await expect(loadStateWithRetry(load, 1)).rejects.toThrow("invalid document");
    expect(load).toHaveBeenCalledOnce();
  });
});
