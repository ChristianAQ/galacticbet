import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { configureMobileViewport } from "./lib/mobileViewport";
import { applyTheme, readTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
applyTheme(readTheme());
const resetMobileViewport = configureMobileViewport();
if (import.meta.hot) import.meta.hot.dispose(resetMobileViewport);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Synchronous updates: view transitions snapshot the new page, not the old one. */}
    <HashRouter useTransitions={false}>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
