CREATE TABLE `points_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`submission_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`stake_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `points_ledger_user_idx` ON `points_ledger` (`user_id`);--> statement-breakpoint
CREATE INDEX `points_ledger_submission_idx` ON `points_ledger` (`submission_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logo_r2_key` text,
	`description` text DEFAULT '' NOT NULL,
	`website_url` text,
	`referral_url` text,
	`dub_link_id` text,
	`short_url` text,
	`category` text DEFAULT 'infra' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`campaign_start_date` integer
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`tx_hash` text,
	`proof_r2_key` text,
	`proof_url` text,
	`oauth_payload` text,
	`rejection_reason` text,
	`submitted_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`verified_at` integer,
	`payout_batch_id` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`stake_address`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_user_task_tx_unique` ON `submissions` (`user_id`,`task_id`,`tx_hash`);--> statement-breakpoint
CREATE INDEX `submissions_task_idx` ON `submissions` (`task_id`);--> statement-breakpoint
CREATE INDEX `submissions_user_idx` ON `submissions` (`user_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`task_type` text NOT NULL,
	`task_config` text,
	`verification_method` text DEFAULT 'manual' NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`token_reward` text,
	`starts_at` integer,
	`ends_at` integer,
	`max_completions_per_user` integer DEFAULT 1 NOT NULL,
	`total_completion_cap` integer DEFAULT 0 NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);