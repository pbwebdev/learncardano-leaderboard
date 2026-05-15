CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`timestamp` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`stake_address` text PRIMARY KEY NOT NULL,
	`payment_address` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`age_bracket` text,
	`country` text,
	`experience_level` text,
	`referral_source` text,
	`ref_code` text,
	`invited_by_ref_code` text,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`x_user_id` text,
	`x_handle` text,
	`youtube_channel_id` text,
	`profile_visibility` text DEFAULT 'public' NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_ref_code_unique` ON `users` (`ref_code`);