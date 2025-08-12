/**
 * Shim for `window.localStorage` that persists via server calls to `wry` window.
 */
class LocalStorageShim {
  state: Record<string, string>;

  constructor(state: Record<string, string>) {
    this.state = state;
    console.log(this.state);
  }

  getItem(key: string) {
    return this.state[key];
  }

  setItem(key: string, value: string) {
    this.state[key] = value;
    this.#persist();
  }

  deleteItem(key: string) {
    delete this.state[key];
    this.#persist();
  }

  clear() {
    this.state = {};
    this.#persist();
  }

  async #persist() {
    await fetch(`/_wry/localStorage`, {
      mode: "cors",
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.state),
    });
  }
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
