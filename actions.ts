import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR", "SOA"] as const;

const zoneOut = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  recordCount: z.number(),
  activeCount: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

const recordOut = z.object({
  id: z.number(),
  zoneId: z.number(),
  zoneName: z.string(),
  name: z.string(),
  type: z.string(),
  content: z.string(),
  ttl: z.number(),
  priority: z.number().nullable(),
  enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

export const Actions = {
  getPanel: defineAction({
    description: "Returns all zones and DNS records plus dashboard statistics.",
    request: z.object({}),
    response: z.object({
      zones: z.array(zoneOut),
      records: z.array(recordOut),
      stats: z.object({
        zoneCount: z.number(),
        recordCount: z.number(),
        activeCount: z.number(),
        disabledCount: z.number(),
        byType: z.array(z.object({ type: z.string(), count: z.number() })),
      }),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const zoneRows = await db.select().from(schema.zones).orderBy(asc(schema.zones.name));
      const recordRows = await db.select().from(schema.records).orderBy(desc(schema.records.updatedAt));
      const zoneNameById = new Map(zoneRows.map((zn) => [zn.id, zn.name]));

      const zones = zoneRows.map((zn) => {
        const zr = recordRows.filter((r) => r.zoneId === zn.id);
        return {
          id: zn.id,
          name: zn.name,
          description: zn.description,
          recordCount: zr.length,
          activeCount: zr.filter((r) => r.enabled === 1).length,
          created_at: zn.createdAt.toISOString(),
          updated_at: zn.updatedAt.toISOString(),
        };
      });

      const records = recordRows.map((r) => ({
        id: r.id,
        zoneId: r.zoneId,
        zoneName: zoneNameById.get(r.zoneId) ?? "",
        name: r.name,
        type: r.type as string,
        content: r.content,
        ttl: r.ttl,
        priority: r.priority,
        enabled: r.enabled === 1,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      }));

      const byType = RECORD_TYPES.map((t) => ({
        type: t as string,
        count: recordRows.filter((r) => r.type === t).length,
      })).filter((x) => x.count > 0);

      return {
        zones,
        records,
        stats: {
          zoneCount: zoneRows.length,
          recordCount: recordRows.length,
          activeCount: recordRows.filter((r) => r.enabled === 1).length,
          disabledCount: recordRows.filter((r) => r.enabled !== 1).length,
          byType,
        },
      };
    },
  }),

  createZone: defineAction({
    description: "Creates a new DNS zone (domain).",
    request: z.object({
      name: z.string().min(1),
      description: z.string().default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const name = normalizeDomain(args.name);
      if (!name.includes(".")) throw new Error("نام دامنه معتبر نیست");
      const existing = await db.select().from(schema.zones).where(eq(schema.zones.name, name));
      if (existing.length > 0) throw new Error("این دامنه قبلاً اضافه شده است");
      const now = new Date();
      const res = await db
        .insert(schema.zones)
        .values({ name, description: args.description.trim(), createdAt: now, updatedAt: now })
        .returning({ id: schema.zones.id });
      const row = res[0];
      if (!row) throw new Error("createZone failed");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  updateZone: defineAction({
    description: "Updates a zone's name or description.",
    request: z.object({
      id: z.number().int(),
      name: z.string().min(1),
      description: z.string().default(""),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const name = normalizeDomain(args.name);
      if (!name.includes(".")) throw new Error("نام دامنه معتبر نیست");
      await db
        .update(schema.zones)
        .set({ name, description: args.description.trim(), updatedAt: new Date() })
        .where(eq(schema.zones.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteZone: defineAction({
    description: "Deletes a zone and all of its DNS records.",
    request: z.object({ id: z.number().int() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.records).where(eq(schema.records.zoneId, args.id));
      await db.delete(schema.zones).where(eq(schema.zones.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  createRecord: defineAction({
    description: "Creates a DNS record inside a zone.",
    request: z.object({
      zoneId: z.number().int(),
      name: z.string().min(1),
      type: z.enum(RECORD_TYPES),
      content: z.string().min(1),
      ttl: z.number().int().min(60).max(604800).default(3600),
      priority: z.number().int().min(0).max(65535).nullable().default(null),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const res = await db
        .insert(schema.records)
        .values({
          zoneId: args.zoneId,
          name: args.name.trim(),
          type: args.type,
          content: args.content.trim(),
          ttl: args.ttl,
          priority: args.type === "MX" || args.type === "SRV" ? args.priority : null,
          enabled: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.records.id });
      const row = res[0];
      if (!row) throw new Error("createRecord failed");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  updateRecord: defineAction({
    description: "Updates an existing DNS record.",
    request: z.object({
      id: z.number().int(),
      name: z.string().min(1),
      type: z.enum(RECORD_TYPES),
      content: z.string().min(1),
      ttl: z.number().int().min(60).max(604800),
      priority: z.number().int().min(0).max(65535).nullable().default(null),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.records)
        .set({
          name: args.name.trim(),
          type: args.type,
          content: args.content.trim(),
          ttl: args.ttl,
          priority: args.type === "MX" || args.type === "SRV" ? args.priority : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.records.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  toggleRecord: defineAction({
    description: "Enables or disables a DNS record.",
    request: z.object({ id: z.number().int(), enabled: z.boolean() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.records)
        .set({ enabled: args.enabled ? 1 : 0, updatedAt: new Date() })
        .where(eq(schema.records.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteRecord: defineAction({
    description: "Deletes a DNS record.",
    request: z.object({ id: z.number().int() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.records).where(eq(schema.records.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  checkDns: defineAction({
    description: "Performs a real public DNS lookup for a hostname via Google DNS-over-HTTPS.",
    request: z.object({
      name: z.string().min(1),
      type: z.enum(RECORD_TYPES).default("A"),
    }),
    response: z.object({
      status: z.number(),
      answers: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          ttl: z.number(),
          data: z.string(),
        }),
      ),
      checkedAt: z.string(),
    }),
    async handler(_ctx, args) {
      const typeMap: Record<string, number> = {
        A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257,
      };
      const numToType: Record<number, string> = Object.fromEntries(
        Object.entries(typeMap).map(([k, v]) => [v, k]),
      );
      const host = normalizeDomain(args.name);
      const url = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${encodeURIComponent(args.type)}`;
      const res = await fetch(url, { headers: { accept: "application/dns-json" } });
      if (!res.ok) throw new Error("سرویس بررسی DNS پاسخ نداد");
      const json = (await res.json()) as {
        Status?: number;
        Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
      };
      return {
        status: json.Status ?? -1,
        answers: (json.Answer ?? []).map((a) => ({
          name: a.name,
          type: numToType[a.type] ?? String(a.type),
          ttl: a.TTL,
          data: a.data,
        })),
        checkedAt: new Date().toISOString(),
      };
    },
  }),
} satisfies ActionsModule;
