CREATE TABLE `click_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tracked_link_id` text NOT NULL,
	`dub_event_id` text,
	`user_id` text,
	`country` text,
	`referrer` text,
	`user_agent` text,
	`ts` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`tracked_link_id`) REFERENCES `tracked_links`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `click_events_link_idx` ON `click_events` (`tracked_link_id`);--> statement-breakpoint
CREATE INDEX `click_events_user_idx` ON `click_events` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `click_events_link_event_unique` ON `click_events` (`tracked_link_id`,`dub_event_id`);--> statement-breakpoint
CREATE TABLE `tracked_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`user_ref_code` text,
	`dub_link_id` text NOT NULL,
	`short_url` text NOT NULL,
	`destination_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_links_dub_link_unique` ON `tracked_links` (`dub_link_id`);--> statement-breakpoint
CREATE INDEX `tracked_links_project_idx` ON `tracked_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `tracked_links_ref_code_idx` ON `tracked_links` (`user_ref_code`);--> statement-breakpoint
ALTER TABLE `users` ADD `x_connected_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `x_access_token_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `x_refresh_token_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `x_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `youtube_channel_title` text;--> statement-breakpoint
ALTER TABLE `users` ADD `youtube_connected_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `youtube_access_token_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `youtube_refresh_token_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `youtube_token_expires_at` integer;