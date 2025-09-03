declare global {
  var __localStorage__: Storage;
}

/**
 * Shim for `window.localStorage` that persists via server calls to `wry` window.
 */
class LocalStorageShim {
  static install(restoreState: Record<string, string>) {
    globalThis.__localStorage__ = globalThis.localStorage;
    Object.defineProperty(
      globalThis,
      "localStorage",
      { value: new LocalStorageShim(restoreState) },
    );
  }

  constructor(state: Record<string, string>) {
    const version = import.meta.env.VITE_BUILD_VERSION;
    if (globalThis.__localStorage__.getItem("__version__") === version) {
      // if we've already seeded from a previous load, just use the existing state
    } else {
      // otherwise, seed local storage with the server's version and use that
      globalThis.__localStorage__.setItem("__version__", version);
      for (const [key, value] of Object.entries(state)) {
        globalThis.__localStorage__.setItem(key, value);
      }
    }

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
    return Object.keys(globalThis.__localStorage__).length;
  }

  index(i: number) {
    return globalThis
      .__localStorage__[Object.keys(globalThis.__localStorage__)[i]];
  }

  key(i: number) {
    return Object.keys(globalThis.__localStorage__)[i];
  }

  getItem(key: string) {
    return globalThis.__localStorage__.getItem(key);
  }

  setItem(key: string, value: string) {
    globalThis.__localStorage__.setItem(key, value);
    persist();
  }

  deleteItem(key: string) {
    globalThis.__localStorage__.deleteItem(key);
    persist();
  }

  clear() {
    globalThis.__localStorage__.clear();
    persist();
  }
}

function persist() {
  globalThis.ipc.postMessage(
    "local-storage:" + JSON.stringify(globalThis.__localStorage__),
  );
}

// When running bundled, persist local storage via backend.
// The port will change each app restart, so we need to restore
// `window.localStorage` manually on launch.
if (import.meta.env.VITE_LOCAL_STORAGE) {
  const state = JSON.parse(import.meta.env.VITE_LOCAL_STORAGE);
  LocalStorageShim.install(state);
}
