/**
 * Shim for `window.localStorage` that persists via server calls to `wry` window.
 */
class LocalStorageShim {
  private state: Record<string, string>;

  // FIXME: send version along with initial hydrate; only seed when version
  // doesn't match, and use real `window.localStorage` for persistence, so
  // page reloading doesn't cause loss of state
  constructor(state: Record<string, string>) {
    this.state = state;

    return new Proxy(this, {
      get: (target, key) => {
        if (typeof key === "number") {
          return target.index(key);
        }
        return target[key as keyof this];
      },
    });
  }

  get length() {
    return Object.keys(this.state).length;
  }

  index(i: number) {
    return this.state[Object.keys(this.state)[i]];
  }

  key(i: number) {
    return Object.keys(this.state)[i];
  }

  getItem(key: string) {
    return this.state[key];
  }

  setItem(key: string, value: string) {
    this.state[key] = value;
    persist(this.state);
  }

  deleteItem(key: string) {
    delete this.state[key];
    persist(this.state);
  }

  clear() {
    this.state = {};
    persist(this.state);
  }
}

function persist(state: Record<string, string>) {
  globalThis.ipc.postMessage("local-storage:" + JSON.stringify(state));
}

// When running bundled, persist local storage via backend.
// The port will change each app restart, so we need to restore
// `window.localStorage` manually on launch.
if (import.meta.env.VITE_LOCAL_STORAGE) {
  const state = JSON.parse(import.meta.env.VITE_LOCAL_STORAGE);
  Object.defineProperty(
    globalThis,
    "localStorage",
    { value: new LocalStorageShim(state) },
  );
}
