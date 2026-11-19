CREATE TABLE "ai_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"feature_type" text NOT NULL,
	"source_id" text,
	"input_text" text NOT NULL,
	"expected_output" text,
	"actual_output" text NOT NULL,
	"grounding_score" integer,
	"relevance_score" integer,
	"accepted" boolean,
	"latency_ms" integer,
	"model" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_evaluations" ADD CONSTRAINT "ai_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;