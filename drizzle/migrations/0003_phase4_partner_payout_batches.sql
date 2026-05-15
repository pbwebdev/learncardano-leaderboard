CREATE TABLE `partner_payout_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`csv_r2_key` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`tx_hash` text,
	`paid_at` integer,
	`verified_on_chain` integer DEFAULT false NOT NULL,
	`discrepancy_note` text,
	`recorded_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`stake_address`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partner_payout_batches_tx_hash_unique` ON `partner_payout_batches` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `partner_payout_batches_project_idx` ON `partner_payout_batches` (`project_id`);