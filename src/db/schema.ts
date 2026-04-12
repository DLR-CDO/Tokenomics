import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const sourceSystemEnum = pgEnum("source_system", ["cursor", "openai", "azure", "openai_enterprise"]);

export const metricKindEnum = pgEnum("metric_kind", [
  "tokens_in",
  "tokens_out",
  "requests",
  "cost_usd",
  "dau",
  "wau",
  "lines_added",
  "lines_deleted",
  "tabs_shown",
  "tabs_accepted",
  "tabs_rejected",
  "agent_edits_accepted",
  "agent_edits_rejected",
  "credits",
]);

export const connectorRunStatusEnum = pgEnum("connector_run_status", ["running", "success", "failed"]);

export const dimMember = pgTable(
  "dim_member",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    externalKey: text("external_key").notNull(),
    displayName: text("display_name"),
    email: text("email"),
    role: text("role"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("dim_member_source_external").on(t.sourceSystem, t.externalKey)],
);

export const dimModel = pgTable(
  "dim_model",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    externalKey: text("external_key").notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("dim_model_source_external").on(t.sourceSystem, t.externalKey)],
);

export const billingCycles = pgTable(
  "billing_cycles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    label: text("label"),
    cycleStart: timestamp("cycle_start", { withTimezone: true }).notNull(),
    cycleEnd: timestamp("cycle_end", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("billing_cycles_source_range").on(t.sourceSystem, t.cycleStart, t.cycleEnd)],
);

export const usageFacts = pgTable(
  "usage_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    metricKind: metricKindEnum("metric_kind").notNull(),
    amount: doublePrecision("amount").notNull(),
    memberId: uuid("member_id").references(() => dimMember.id, { onDelete: "set null" }),
    modelId: uuid("model_id").references(() => dimModel.id, { onDelete: "set null" }),
    modelName: text("model_name"),
    mode: text("mode"),
    billingGroupId: text("billing_group_id"),
    billingGroupName: text("billing_group_name"),
    dimensionsJson: jsonb("dimensions_json").$type<Record<string, unknown>>(),
    externalId: text("external_id").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("usage_facts_source_external").on(t.sourceSystem, t.externalId),
    index("usage_facts_time_source").on(t.occurredAt, t.sourceSystem),
    index("usage_facts_member_time").on(t.memberId, t.occurredAt),
    index("usage_facts_model_time").on(t.modelName, t.occurredAt),
  ],
);

export const connectorRuns = pgTable(
  "connector_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    connectorName: text("connector_name").notNull(),
    status: connectorRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowsUpserted: integer("rows_upserted").notNull().default(0),
    errorMessage: text("error_message"),
    watermarkAt: timestamp("watermark_at", { withTimezone: true }),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
  },
  (t) => [index("connector_runs_source_started").on(t.sourceSystem, t.startedAt)],
);

export const dashboardSettings = pgTable("dashboard_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UsageFactRow = typeof usageFacts.$inferSelect;
export type DimMemberRow = typeof dimMember.$inferSelect;
export type DimModelRow = typeof dimModel.$inferSelect;
export type DashboardSettingRow = typeof dashboardSettings.$inferSelect;
