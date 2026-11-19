import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { configureMobileViewport } from "./lib/mobileViewport";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/big-shoulders-display";
import "./styles.css";
import "./styles/sportsTheme.css";
import "./styles/mobileExperience.css";
import "./styles/ios.css";
import "./styles/matchday.css";
const resetMobileViewport = configureMobileViewport();
if (import.meta.hot) import.meta.hot.dispose(resetMobileViewport);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
