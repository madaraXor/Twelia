import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { I18nProvider } from "./i18n/i18n";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Élément racine introuvable.");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
