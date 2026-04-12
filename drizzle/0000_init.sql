CREATE TYPE "public"."connector_run_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."metric_kind" AS ENUM('tokens_in', 'tokens_out', 'requests', 'cost_usd', 'dau', 'wau', 'lines_added', 'agent_edits_accepted', 'agent_edits_rejected');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('cursor', 'openai', 'azure');--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"label" text,
	"cycle_start" timestamp with time zone NOT NULL,
	"cycle_end" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"connector_name" text NOT NULL,
	"status" "connector_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"watermark_at" timestamp with time zone,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "dim_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"external_key" text NOT NULL,
	"display_name" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" "source_system" NOT NULL,
	"external_key" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_system" "source_system" NOT NULL,
	"metric_kind" "metric_kind" NOT NULL,
	"amount" double precision NOT NULL,
	"member_id" uuid,
	"model_id" uuid,
	"model_name" text,
	"mode" text,
	"billing_group_id" text,
	"billing_group_name" text,
	"dimensions_json" jsonb,
	"external_id" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_facts" ADD CONSTRAINT "usage_facts_member_id_dim_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."dim_member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_facts" ADD CONSTRAINT "usage_facts_model_id_dim_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."dim_model"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_cycles_source_range" ON "billing_cycles" USING btree ("source_system","cycle_start","cycle_end");--> statement-breakpoint
CREATE INDEX "connector_runs_source_started" ON "connector_runs" USING btree ("source_system","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dim_member_source_external" ON "dim_member" USING btree ("source_system","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "dim_model_source_external" ON "dim_model" USING btree ("source_system","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_facts_source_external" ON "usage_facts" USING btree ("source_system","external_id");--> statement-breakpoint
CREATE INDEX "usage_facts_time_source" ON "usage_facts" USING btree ("occurred_at","source_system");--> statement-breakpoint
CREATE INDEX "usage_facts_member_time" ON "usage_facts" USING btree ("member_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_facts_model_time" ON "usage_facts" USING btree ("model_name","occurred_at");