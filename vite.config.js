import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        "**/android-exam-browser/**",
        "**/apk-analysis/**",
        "**/dist/**",
        "**/node_modules/**"
      ]
    }
  }
});
