CREATE TABLE "github_task_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"task_id" text NOT NULL,
	"confidence" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "github_task_matches" ADD CONSTRAINT "github_task_matches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_task_matches" ADD CONSTRAINT "github_task_matches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;