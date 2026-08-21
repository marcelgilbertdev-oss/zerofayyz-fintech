import { mount } from "svelte";

import App from "./App.svelte";

document.body.style.margin = "0";
document.body.style.background = "#07110f";
document.body.style.fontFamily =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const target = document.getElementById("app");

if (!target) {
  throw new Error("#app mount point is missing from index.html");
}

mount(App, { target });
