CREATE TABLE "operational_counters" (
	"event" varchar(24) NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "operational_counters_event_minute_pk" PRIMARY KEY("event","minute"),
	CONSTRAINT "operational_event_valid" CHECK ("operational_counters"."event" in ('request_error','rate_limit','push_failure','wallet_failure')),
	CONSTRAINT "operational_count_valid" CHECK ("operational_counters"."count" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "service_usage" (
	"service" varchar(12) NOT NULL,
	"month" date NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "service_usage_service_month_pk" PRIMARY KEY("service","month"),
	CONSTRAINT "service_usage_service_valid" CHECK ("service_usage"."service" in ('email','wallet','push')),
	CONSTRAINT "service_usage_attempts_valid" CHECK ("service_usage"."attempts" between 1 and 10000000)
);
