import { execSync } from "node:child_process";
import { platform } from "node:os";

if (platform() !== "linux") process.exit(0);

try {
  execSync(
    'find node_modules -type f \\( -path "*/@esbuild/*/bin/esbuild" -o -name "*.node" \\) -exec chmod +x {} + 2>/dev/null || true',
    { stdio: "inherit", shell: "/bin/sh" },
  );
} catch {
  // Non-fatal: shared hosts may block exec even after chmod.
}
