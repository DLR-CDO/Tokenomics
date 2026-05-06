ALTER TYPE "public"."metric_kind" ADD VALUE 'mau' BEFORE 'lines_added';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'lines_deleted' BEFORE 'agent_edits_accepted';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'tabs_shown' BEFORE 'agent_edits_accepted';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'tabs_accepted' BEFORE 'agent_edits_accepted';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'tabs_rejected' BEFORE 'agent_edits_accepted';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'credits';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'sessions';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'commits';--> statement-breakpoint
ALTER TYPE "public"."metric_kind" ADD VALUE 'pull_requests';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'openai_enterprise';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'claude';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'claude_enterprise';--> statement-breakpoint
CREATE TABLE "dashboard_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dim_member" ADD COLUMN "role" text;