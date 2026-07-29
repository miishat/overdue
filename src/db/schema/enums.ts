import { pgEnum } from "drizzle-orm/pg-core";

export const PROVIDER_NAMES = [
  "manual",
  "hardcover",
  "wikidata",
  "openlibrary",
  "google",
] as const;

export const DATE_PRECISIONS = [
  "day",
  "month",
  "quarter",
  "season",
  "year",
] as const;

export const RELEASE_STATUSES = [
  "RELEASED",
  "DATED",
  "ESTIMATED",
  "ANNOUNCED",
  "RUMORED",
  "EXPECTED",
  "HIATUS",
  "COMPLETE",
] as const;

export const SERIES_STATUSES = ["ongoing", "complete", "hiatus"] as const;

export const READ_STATE_VALUES = [
  "want",
  "reading",
  "read",
  "skipped",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type DatePrecision = (typeof DATE_PRECISIONS)[number];
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
export type SeriesStatus = (typeof SERIES_STATUSES)[number];
export type ReadStateValue = (typeof READ_STATE_VALUES)[number];

export const providerName = pgEnum("provider_name", PROVIDER_NAMES);
export const datePrecision = pgEnum("date_precision", DATE_PRECISIONS);
export const releaseStatus = pgEnum("release_status", RELEASE_STATUSES);
export const seriesStatus = pgEnum("series_status", SERIES_STATUSES);
export const readStateValue = pgEnum("read_state_value", READ_STATE_VALUES);
