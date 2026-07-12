import { createSessionStore } from "./GameSessionManager";
import type { GameSession, SessionRuntime } from "./gameTypes";

class FakeRuntime implements SessionRuntime {
  createCalls = 0;
  startCalls = 0;
  create(accountId: string): Promise<GameSession> {
    this.createCalls += 1;
    const now = new Date().toISOString();
    return Promise.resolve({
      id: `session-${accountId}`,
      accountId,
      status: "created",
      createdAt: now,
      updatedAt: now,
    });
  }
  start(): Promise<void> {
    this.startCalls += 1;
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  reload(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

describe("GameSessionManager", () => {
  it("réutilise la session existante d’un compte", async () => {
    const runtime = new FakeRuntime();
    const store = createSessionStore(runtime);
    const first = await store.getState().createForAccount("account-a");
    const second = await store.getState().createForAccount("account-a");
    expect(first.id).toBe(second.id);
    expect(runtime.createCalls).toBe(1);
  });

  it("suit les transitions de suspension et reprise", async () => {
    const store = createSessionStore(new FakeRuntime());
    const session = await store.getState().createForAccount("account-a");
    await store.getState().start(session.id);
    expect(store.getState().sessions[session.id]?.status).toBe("running");
    await store.getState().suspend(session.id);
    expect(store.getState().sessions[session.id]?.status).toBe("suspended");
    await store.getState().resume(session.id);
    expect(store.getState().sessions[session.id]?.status).toBe("running");
  });

  it("fusionne les créations et démarrages concurrents", async () => {
    const runtime = new FakeRuntime();
    const store = createSessionStore(runtime);
    const [first, second] = await Promise.all([
      store.getState().createForAccount("account-a"),
      store.getState().createForAccount("account-a"),
    ]);
    await Promise.all([store.getState().start(first.id), store.getState().start(second.id)]);
    expect(runtime.createCalls).toBe(1);
    expect(runtime.startCalls).toBe(1);
  });
});
