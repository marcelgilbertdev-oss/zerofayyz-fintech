import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";

document.body.style.margin = "0";
document.body.style.background = "#07110f";
document.body.style.fontFamily =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

createApp(App).use(createPinia()).mount("#app");
