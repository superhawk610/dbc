// this is provided by `wry`
declare global {
  var ipc: {
    postMessage(message: string): void;
  };
}

export default function ipc(message: string) {
  globalThis.ipc.postMessage(message);
}
