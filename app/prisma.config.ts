import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Validation is local-only. A real managed PostgreSQL URL is an owner decision for a later phase.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/funnel_control?schema=public",
  },
});
