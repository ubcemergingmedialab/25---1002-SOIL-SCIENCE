import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import glsl from "vite-plugin-glsl";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: __dirname,
  publicDir: path.resolve(repoRoot, "public"),
  plugins: [
    react(),
    glsl({
      include: ["**/*.glsl", "**/*.vert", "**/*.frag", "**/*.wgsl"],
      warnDuplicatedImports: true,
      defaultExtension: "glsl",
      minify: false,
    }),
  ],
  assetsInclude: ["**/*.ksplat"],
  resolve: {
    alias: {
      "@soil/shared": path.resolve(repoRoot, "packages/shared/src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
