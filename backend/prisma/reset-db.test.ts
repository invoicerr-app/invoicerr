import { config } from "dotenv";
import { execSync } from "child_process";
import path from "path";

const envPath = path.resolve(__dirname, "../.env.test");

config({ path: envPath });


const schemaPath = path.resolve(__dirname, "./schema.prisma");

try {
    execSync(`npx prisma migrate reset --force --schema=${schemaPath}`, { stdio: "inherit" })
} catch (error) {
    console.error("Error resetting the database:", error);
    //Do nothing
}