import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@flux/shared-ui/components/theme-provider";
import App from "./App";
import "./index.css";

const syncNativeTheme = (theme: "dark" | "light" | "system") => {
  void window.electronAPI?.setTheme(theme);
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="flux-ui-theme" onThemeChange={syncNativeTheme}>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
