import type Database from "better-sqlite3";
import { ruleOperator } from "../src/rule-operators.ts";
import { runInNewContext } from "node:vm";
import {
  compileConditionLogic,
  evaluateRuleExpression,
} from "../src/rule-logic.ts";
import { expressionFeatureNames } from "./feature-refs.ts";

export function executableRule(db: Database.Database, rule: any) {
  if (
    !rule?.sourceImported ||
    Number(rule.editMode) !== 7 ||
    !/^[\d\s()!&|]+$/.test(rule.expression)
  )
    return rule;
  const row = db
    .prepare(
      "SELECT json_extract(data,'$.logic.ruleConditions') AS conditions FROM source_archives WHERE kind='rule' AND id=? AND version=''",
    )
    .get(rule.id) as any;
  const conditions = JSON.parse(row?.conditions || "[]");
  if (!Array.isArray(conditions) || !conditions.length)
    throw Error("本地缺少该子规则的交互式条件");
  const operand = (p: any, dataType: number) => {
    if (p.type === 0 && !p.funcName && /^[A-Za-z_$][\w$]*$/.test(p.value))
      return p.value;
    if (p.type !== 1) throw Error("该条件依赖未接入的 Zeus 函数或资源");
    if (dataType === 1 && Number.isFinite(Number(p.value)))
      return String(Number(p.value));
    if (dataType === 0 && ["true", "false"].includes(String(p.value)))
      return String(p.value);
    return JSON.stringify(String(p.value));
  };
  const parse = (v: any) =>
    typeof v === "string" ? JSON.parse(v || "[]") : v || [];
  const parts = conditions.map((c: any, i: number) => {
    if (Number(c.index) !== i + 1 || !ruleOperator(c.operatorName))
      throw Error("本地不支持此交互式条件");
    const left = parse(c.leftParamValue),
      right = parse(c.rightParamValue);
    if (left.length !== 1 || !Array.isArray(right))
      throw Error("本地不支持此变量形式");
    const args = [
      operand(left[0], c.dataType),
      ...right.map((p: any) => {
        // Resource selections are serialized as type 3, including value packages.
        if (p.type === 3 || p.type === 6) {
          if (/(?:hitKeywordBag|hitPictureBag|hitRule)$/.test(c.operatorName))
            return JSON.stringify(String(p.value));
          throw Error("该条件依赖 Zeus 值包，本地未收录值包内容");
        }
        return operand(p, c.dataType);
      }),
    ];
    if (c.operatorName.endsWith("_hitRule") && right[0]?.appendix)
      args.push(JSON.stringify(right[0].appendix));
    return c.operatorName + "(" + args.join(",") + ")";
  });
  return { ...rule, expression: compileConditionLogic(rule.expression, parts) };
}
// Interpret only supported predicates. Never execute stored Aviator as JavaScript.
export function evaluateWithCatalog(
  expression: string,
  input: Record<string, unknown>,
  getRule: (id: number) => any,
  parents: number[] = [],
): boolean {
  return evaluateRuleExpression(expression, input, (op, left, args) => {
    if (op === "regexMatch") {
      if (typeof left !== "string") throw Error("模糊匹配需要字符串");
      return args.some((pattern) =>
        runInNewContext(
          "new RegExp(pattern).test(value)",
          { pattern: String(pattern), value: left },
          { timeout: 25 },
        ),
      );
    }
    if (op === "hitRule") {
      const id = Number(args[0]),
        rule = getRule(id);
      if (!rule) throw Error("未找到子规则 " + id);
      if (parents.includes(id) || parents.length >= 12)
        throw Error("子规则循环引用或嵌套层数过多");
      const names = [...expressionFeatureNames(rule.expression)];
      const param = args[1] || (names.length === 1 ? names[0] : undefined);
      if (!param && (left === null || typeof left !== "object"))
        throw Error("请指定子规则的元素映射入参");
      const context = param
        ? { ...input, [String(param)]: left }
        : { ...input, ...(left as object) };
      return evaluateWithCatalog(rule.expression, context, getRule, [
        ...parents,
        id,
      ]);
    }
    throw Error(
      "本地未接入" +
        (op === "hitKeywordBag" ? "词包" : "图包") +
        "匹配服务，无法执行资源 " +
        args.join("、"),
    );
  });
}
