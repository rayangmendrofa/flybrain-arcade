import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Site from "../src/site/Site";
import "../src/site/site.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
