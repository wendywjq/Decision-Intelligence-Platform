import { test } from "node:test";
import assert from "node:assert/strict";
import { operatorsFor, conditionExpression } from "../src/rule-operators.ts";
import { compileConditionLogic } from "../src/rule-logic.ts";
import { evaluateWithCatalog } from "../server/evaluate-rule.ts";
test("feature result type selects the Zeus operators and preserves literal types", () => {
  const names = (type: string) => operatorsFor(type).map((o) => o.value);
  assert.ok(names("String").includes("hitKeywordBag"));
  assert.ok(!names("String").includes("greaterThan"));
  assert.ok(names("List").includes("any_hitRule"));
  assert.ok(!names("List").includes("hitKeywordBag"));
  assert.equal(
    conditionExpression({
      feature: "id",
      dataType: "String",
      operator: "equal",
      value: ["001"],
    }),
    'id == "001"',
  );
  assert.equal(
    conditionExpression({
      feature: "flag",
      dataType: "Boolean",
      operator: "hit",
    }),
    "hit(flag)",
  );
  assert.throws(() =>
    conditionExpression({
      feature: "flag",
      dataType: "Boolean",
      operator: "greaterThan",
      value: "1",
    }),
  );
});
test("local test evaluates list and unary predicates and binds the list element in a referenced rule", () => {
  const expressions = [
    conditionExpression({
      feature: "scores",
      dataType: "List",
      operator: "any_hitRule",
      value: "10",
      elementParam: "score",
    }),
    conditionExpression({
      feature: "label",
      dataType: "String",
      operator: "contain",
      value: ["foo", "bar"],
    }),
    conditionExpression({
      feature: "extra",
      dataType: "Map",
      operator: "empty",
    }),
  ];
  const expr = compileConditionLogic("1&&(2||3)", expressions);
  const get = (id: number) =>
    id === 10 ? { expression: "score >= 4" } : undefined;
  assert.equal(
    evaluateWithCatalog(expr, { scores: [1, 4], label: "x", extra: {} }, get),
    true,
  );
  assert.equal(
    evaluateWithCatalog(expr, { scores: [1], label: "foo", extra: {} }, get),
    false,
  );
  assert.equal(
    evaluateWithCatalog(
      '##exp - 5\nreturn regexMatch(label,"^ab");',
      { label: "abc" },
      get,
    ),
    true,
  );
  assert.throws(
    () =>
      evaluateWithCatalog('hitKeywordBag(label,"321")', { label: "321" }, get),
    /词包/,
  );
  assert.throws(
    () =>
      evaluateWithCatalog(
        'any_hitRule(items,"1","item")',
        { items: [1] },
        () => ({ expression: 'any_hitRule(items,"1","item")' }),
      ),
    /循环/,
  );
});

test("short-circuited conditions do not need packages or feature values", () => {
  assert.equal(
    evaluateWithCatalog(
      'true || hitKeywordBag(missing,"42")',
      {},
      () => undefined,
    ),
    true,
  );
  assert.equal(
    evaluateWithCatalog("false && missing > 0", {}, () => undefined),
    false,
  );
});
