import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/ibm-plex-sans/index.css";
import "./styles/viewer.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary label="This page">
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
