import path from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import glsl from "vite-plugin-glsl";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const workOutDir = path.resolve(repoRoot, "work/out");

/** Dev-only static route: /work-out/{basename}/lod-meta.json → repo work/out/ */
function serveWorkOutPlugin(): Plugin {
  return {
    name: "serve-work-out",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/work-out", (req, res, next) => {
        const urlPath = req.url?.split("?")[0] ?? "";
        if (!urlPath || urlPath === "/") return next();

        const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, "");
        const filePath = path.resolve(workOutDir, rel);
        const relToRoot = path.relative(workOutDir, filePath);
        if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        if (!existsSync(filePath)) return next();

        const stat = statSync(filePath);
        if (stat.isDirectory()) return next();

        const ext = path.extname(filePath).toLowerCase();
        const types: Record<string, string> = {
          ".json": "application/json",
          ".webp": "image/webp",
        };
        if (types[ext]) res.setHeader("Content-Type", types[ext]);

        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  envDir: repoRoot,
  publicDir: path.resolve(repoRoot, "public"),
  plugins: [
    react(),
    glsl({
      include: ["**/*.glsl", "**/*.vert", "**/*.frag", "**/*.wgsl"],
      warnDuplicatedImports: true,
      defaultExtension: "glsl",
      minify: false,
    }),
    serveWorkOutPlugin(),
  ],
  assetsInclude: ["**/*.ksplat"],
  resolve: {
    alias: {
      "@soil/shared": path.resolve(repoRoot, "packages/shared/src"),
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
