import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const zones = sqliteTable("zones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  zoneId: integer("zone_id")
    .notNull()
    .references(() => zones.id),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR", "SOA"],
  }).notNull(),
  content: text("content").notNull(),
  ttl: integer("ttl").notNull().default(3600),
  priority: integer("priority"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
