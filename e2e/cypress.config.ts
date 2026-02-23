import { defineConfig } from "cypress";
import { execSync } from "child_process";
import path from "path";

export default defineConfig({
  e2e: {
    video: true,
    experimentalStudio: true,
    baseUrl: process.env.FRONTEND_URL || "http://localhost:6284",
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
    supportFile: "cypress/support/e2e.ts",
    setupNodeEvents(on) {
      on('task', {
        resetDatabase() {
          const backendPath = path.resolve(__dirname, '../backend');
          const schemaPath = path.resolve(backendPath, 'prisma/schema.prisma');
          try {
            execSync(`npx prisma migrate reset --force --schema=${schemaPath}`, {
              cwd: backendPath,
              stdio: 'inherit',
              env: {
                ...process.env,
                DATABASE_URL: 'postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db?schema=public',
              },
            });
            return null;
          } catch (error) {
            console.error('Failed to reset database:', error);
            return null;
          }
        },
      });
    },
  }
});
