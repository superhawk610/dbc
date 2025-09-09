import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeTheme } from "./components/ThemeSelect.tsx";
import App from "./App.tsx";
import ipc from "./ipc.ts";

interface WryContext {
  handlers: Record<string, () => void>;
}

declare global {
  function __wry__(event: string): void;
  var __wryContext__: WryContext;
}

globalThis.__wryContext__ = {
  handlers: {},
};

globalThis.__wry__ = (event: string) => {
  switch (event) {
    case "new-tab":
      globalThis.__wryContext__.handlers.newTab();
      break;
    case "settings":
      globalThis.__wryContext__.handlers.openSettings();
      break;
    case "toggle-results":
      globalThis.__wryContext__.handlers.toggleResults();
      break;
    default:
      console.log("unhandled wry event: ", event);
  }
};

// adapted from https://github.com/tauri-apps/tauri/blob/d54f3b95a63a5b24657e2b206f949d15f8013986/crates/tauri/src/window/scripts/drag.js#L13
document.addEventListener("mousedown", (ev) => {
  const attr = (ev.target as HTMLElement).getAttribute("data-wry-drag-region");
  if (
    attr !== null &&
    attr !== "false" &&
    ev.button === 0 &&
    ev.detail === 1
  ) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ipc("drag-start");
  }
});

initializeTheme();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
