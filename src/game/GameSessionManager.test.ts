import { createSessionStore, findSessionByAccount } from "./GameSessionManager";
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("GameSessionManager", () => {
  it("ignore une ancienne session arrêtée lors de la recherche par compte", () => {
    const now = new Date().toISOString();
    const stopped: GameSession = {
      id: "stopped",
      accountId: "account-a",
      status: "stopped",
      createdAt: now,
      updatedAt: now,
    };
    const running: GameSession = {
      ...stopped,
      id: "running",
      status: "running",
    };
    expect(findSessionByAccount({ stopped, running }, "account-a")).toBe(running);
  });

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
    store.getState().setConnectionStatus(session.id, "connected");
    expect(store.getState().sessions[session.id]?.connectionStatus).toBe("connected");
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

  it("ignore la fin tardive d'une transition devenue obsolète", async () => {
    const suspended = deferred();
    const resumed = deferred();
    const runtime = new FakeRuntime();
    runtime.suspend = () => suspended.promise;
    runtime.resume = () => resumed.promise;
    const store = createSessionStore(runtime);
    const session = await store.getState().createForAccount("account-a");
    await store.getState().start(session.id);

    const suspend = store.getState().suspend(session.id);
    const resume = store.getState().resume(session.id);
    resumed.resolve();
    await resume;
    expect(store.getState().sessions[session.id]?.status).toBe("running");

    suspended.resolve();
    await suspend;
    expect(store.getState().sessions[session.id]?.status).toBe("running");
  });
});
