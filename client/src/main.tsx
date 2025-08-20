import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

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

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
