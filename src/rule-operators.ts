type Family = "number" | "text" | "boolean" | "list" | "map";
type Operand = "none" | "value" | "bag" | "picture" | "rule";
interface Operator {
  value: string;
  label: string;
  operand: Operand;
  multiple: boolean;
  families: Family[];
}
const catalog: Operator[] = [];
function add(
  value: string,
  label: string,
  families: Family[],
  operand: Operand = "value",
  multiple = false,
) {
  catalog.push({ value, label, families, operand, multiple });
}
const allTypes: Family[] = ["number", "text", "boolean", "list", "map"];
add("hit", "命中", ["boolean"], "none");
add("notHit", "不命中", ["boolean"], "none");
for (const [name, label] of [
  ["greaterThan", "大于"],
  ["greaterEqual", "大于等于"],
  ["lessThan", "小于"],
  ["lessEqual", "小于等于"],
])
  add(name, label, ["number"]);
add("equal", "等于任意一个", ["number", "text"], "value", true);
add("notEqual", "不等于任意一个", ["number", "text"], "value", true);
add("contain", "包含任意一个", ["text", "list"], "value", true);
add("notContain", "不包含任意一个", ["text", "list"], "value", true);
add("regexMatch", "模糊匹配", ["text"]);
add("hitKeywordBag", "命中任意一个词包", ["text"], "bag", true);
add("hitPictureBag", "命中任意一个图包", ["text"], "picture", true);
for (const base of [...catalog].filter((op) => op.operand !== "none")) {
  for (const [prefix, label] of [
    ["any", "任意一个元素"],
    ["all", "全部元素"],
  ])
    add(
      prefix + "_" + base.value,
      label + "_" + base.label,
      ["list"],
      base.operand,
      base.multiple || base.value === "regexMatch",
    );
}
add("any_hitRule", "存在一个元素命中规则", ["list"], "rule");
add("all_hitRule", "全部元素命中规则", ["list"], "rule");
add("notEmpty", "不为空", allTypes, "none");
add("empty", "为空", allTypes, "none");
const legacy: Record<string, string> = {
  ">": "greaterThan",
  ">=": "greaterEqual",
  "<": "lessThan",
  "<=": "lessEqual",
  "==": "equal",
  "!=": "notEqual",
};
export const ruleOperator = (name: string) =>
  catalog.find((op) => op.value === (legacy[name] || name));
export function operatorsFor(type: string) {
  const families: Record<string, Family> = {
    Boolean: "boolean",
    Integer: "number",
    Long: "number",
    Double: "number",
    Float: "number",
    String: "text",
    List: "list",
    Map: "map",
  };
  const family = families[type];
  return catalog.filter((op) =>
    family
      ? op.families.includes(family)
      : op.families.length === allTypes.length,
  );
}
export function conditionExpression(c: any): string {
  const op = ruleOperator(c.operator);
  if (!op || !c.feature) throw Error("请选择特征和操作符");
  if (c.dataType && !operatorsFor(c.dataType).includes(op))
    throw Error("操作符与特征类型不匹配");
  const values: unknown[] =
    op.operand === "none" ? [] : Array.isArray(c.value) ? c.value : [c.value];
  if (
    op.operand !== "none" &&
    (!values.length || values.some((v) => v == null || v === ""))
  )
    throw Error("请填写右变量");
  const args = values.map((v) => {
    const numeric =
      ["Integer", "Float", "Double", "Long"].includes(c.dataType) ||
      /(?:greater|less)/i.test(op.value);
    if (
      c.dataType === "Boolean" &&
      op.operand === "value" &&
      ["true", "false"].includes(String(v))
    )
      return String(v);
    if (numeric) {
      if (!Number.isFinite(Number(v))) throw Error("右变量必须为数值");
      return String(Number(v));
    }
    if (op.operand !== "value" && !/^\d+$/.test(String(v)))
      throw Error("请填写有效的资源 ID");
    if (!c.dataType && /^-?\d+(\.\d+)?$|^(true|false)$/.test(String(v)))
      return String(v);
    return JSON.stringify(String(v));
  });
  if (op.operand === "rule" && c.elementParam)
    args.push(JSON.stringify(c.elementParam.trim()));
  const symbol = Object.keys(legacy).find((k) => legacy[k] === op.value);
  if (symbol && args.length === 1)
    return c.feature + " " + symbol + " " + args[0];
  return op.value + "(" + [c.feature, ...args].join(", ") + ")";
}

export type LookupOperator = (
  name: string,
  left: unknown,
  args: unknown[],
) => boolean;
export function matchOperator(
  name: string,
  left: unknown,
  args: unknown[],
  lookup?: LookupOperator,
): boolean {
  const op = ruleOperator(name);
  if (!op || (op.operand === "none" ? args.length !== 0 : !args.length))
    throw Error("无效的操作符或参数：" + name);
  const [scope, base] = name.split("_");
  const match = (v: unknown) => {
    switch (base || name) {
      case "empty":
      case "notEmpty": {
        const empty =
          v == null ||
          v === "" ||
          (typeof v === "object" && Object.keys(v as object).length === 0);
        return name === "empty" ? empty : !empty;
      }
      case "hit":
        return v === true;
      case "notHit":
        return v === false;
      case "equal":
        return args.includes(v);
      case "notEqual":
        return !args.includes(v);
      case "contain":
      case "notContain": {
        const found = args.some((a) =>
          Array.isArray(v)
            ? v.includes(a)
            : typeof v === "string" && typeof a === "string" && v.includes(a),
        );
        return (base || name) === "contain" ? found : !found;
      }
      case "greaterThan":
      case "greaterEqual":
      case "lessThan":
      case "lessEqual": {
        const right = args[0];
        if (typeof v !== "number" || typeof right !== "number")
          throw Error("大小比较需要数值类型");
        switch (base || name) {
          case "greaterThan":
            return v > right;
          case "greaterEqual":
            return v >= right;
          case "lessThan":
            return v < right;
          default:
            return v <= right;
        }
      }
      default:
        if (lookup) return lookup(base || name, v, args);
        throw Error("该操作符需要对应的本地资源：" + op.label);
    }
  };
  if (!base) return match(left);
  if (!Array.isArray(left)) throw Error("元素操作符需要列表类型");
  return scope === "any" ? left.some(match) : left.every(match);
}
