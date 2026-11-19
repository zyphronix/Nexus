CREATE TABLE "github_webhook_events" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repository" text NOT NULL,
	"event_type" text NOT NULL,
	"commit_sha" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"error_message" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;