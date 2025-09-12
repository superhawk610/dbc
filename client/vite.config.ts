import { resolve } from "node:path";
import { defineConfig } from "vite";
import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [deno(), react(), vue(), tailwindcss()],
  // enable runtime Vue template compilation
  resolve: { alias: { vue: "vue/dist/vue.esm-bundler.js" } },
  build: {
    // since we're running locally, don't worry about chunk size
    chunkSizeWarningLimit: 999_999,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "./index.html"),
        explain: resolve(__dirname, "./explain.html"),
      },
    },
  },
});
