/**
 * Identifier helpers for MongoDB queries.
 *
 * Documents written by the Flask app store `_id` as an ObjectId, but some
 * legacy writes and hand-imported data store the hex string instead. Querying
 * with the wrong form silently matches nothing, which is exactly the defect D11
 * class of bug: `delete_one({"namespace": <ObjectId>})` matched zero rows, so
 * `POST /namespace/<ns>/delete` always reported a 500 and never deleted
 * anything.
 *
 * The MongoDB driver converts a 24-character hex string into an ObjectId
 * automatically when it is used against `_id`, so the only thing needed here is
 * case normalisation. Anything that is not 24 hex characters is passed through
 * untouched.
 */

const HEX24 = /^[0-9a-fA-F]{24}$/;

export function isHex24(value: unknown): boolean {
  return typeof value === "string" && HEX24.test(value);
}

/**
 * Coerce a value into something usable as an `_id` in a filter.
 *
 * Lowercases a 24-character hex string; returns everything else unchanged so a
 * real ObjectId passes straight through.
 */
export function toHexOrId(value: unknown): unknown {
  return isHex24(value) ? (value as string).toLowerCase() : value;
}
