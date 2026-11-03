// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Site from "../src/site/Site";
import "../src/site/site.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
