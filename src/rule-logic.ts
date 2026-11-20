import { matchOperator, type LookupOperator } from "./rule-operators.ts";
/** Parse numbered condition logic. No eval or JavaScript execution. */
export function compileConditionLogic(
  logic: string,
  conditions: string[] | Map<number, string>,
): string {
  const text = String(logic || "").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = text.match(/\d+|&&|\|\||!|\(|\)/g) || [];
  if (tokens.join("") !== text.replace(/\s/g, ""))
    throw Error("条件间逻辑仅支持条件编号、&&、||、! 和括号");
  let i = 0;
  const atom = (): string => {
    const t = tokens[i++];
    if (t === "!") return "!" + atom();
    if (t === "(") {
      const v = or();
      if (tokens[i++] !== ")") throw Error("条件间逻辑括号不匹配");
      return "(" + v + ")";
    }
    if (!t || !/^\d+$/.test(t)) throw Error("请输入有效的条件间逻辑");
    const n = Number(t);
    const condition = Array.isArray(conditions)
      ? conditions[n - 1]
      : conditions.get(n);
    if (n < 1 || !condition) throw Error("条件编号 " + n + " 不存在");
    return "(" + condition + ")";
  };
  const and = (): string => {
    let v = atom();
    while (tokens[i] === "&&") {
      i++;
      v += "&&" + atom();
    }
    return v;
  };
  const or = (): string => {
    let v = and();
    while (tokens[i] === "||") {
      i++;
      v += "||" + and();
    }
    return v;
  };
  const result = or();
  if (i !== tokens.length) throw Error("条件间逻辑格式错误");
  return result;
}
export function evaluateRuleExpression(
  expression: string,
  input: Record<string, unknown>,
  lookup?: LookupOperator,
): boolean {
  if (typeof expression !== "string" || !expression.trim())
    throw Error("表达式不能为空");
  const text = expression
    .trim()
    .replace(/^##[^\n]*\n/gm, "")
    .replace(/^\s*return\s+/, "")
    .replace(/;\s*$/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern =
    /\s*(>=|<=|==|!=|&&|\|\||[!,()<>]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*)/gy;
  const tokens: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    if (!text.slice(pos).trim()) break;
    pattern.lastIndex = pos;
    const m = pattern.exec(text);
    if (!m) throw Error("本地表达式引擎不支持此语法（位置 " + pos + "）");
    tokens.push(m[1]);
    pos = pattern.lastIndex;
  }
  let i = 0;
  const value = (active: boolean): unknown => {
    const t = tokens[i++];
    if (!t) throw Error("缺少表达式操作数");
    if (t === "(") {
      const v = or(active);
      if (tokens[i++] !== ")") throw Error("表达式括号不匹配");
      return v;
    }
    if (t === "!") return !Boolean(value(active));
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null" || t === "nil") return null;
    if (/^"/.test(t)) return JSON.parse(t);
    if (/^'/.test(t)) return t.slice(1, -1).replace(/\\'/g, "'");
    if (/^-?\d/.test(t)) return Number(t);
    if (!/^[A-Za-z_$][\w$]*$/.test(t)) throw Error("缺少表达式操作数");
    if (tokens[i] === "(") {
      i++;
      const left = value(active),
        args: unknown[] = [];
      while (tokens[i] === ",") {
        i++;
        args.push(value(active));
      }
      if (tokens[i++] !== ")") throw Error("操作符参数格式错误");
      return active ? matchOperator(t, left, args, lookup) : false;
    }
    if (!active) return undefined;
    if (!Object.prototype.hasOwnProperty.call(input, t))
      throw Error("缺少输入参数：" + t);
    return input[t];
  };
  const comparison = (active: boolean): boolean => {
    const left = value(active),
      op = tokens[i];
    if (![">", ">=", "<", "<=", "==", "!="].includes(op)) return Boolean(left);
    i++;
    const right = value(active);
    if (!active) return false;
    if (op === "==") return left === right;
    if (op === "!=") return left !== right;
    if (typeof left !== "number" || typeof right !== "number")
      throw Error("大小比较需要数值类型");
    return op === ">"
      ? left > right
      : op === ">="
        ? left >= right
        : op === "<"
          ? left < right
          : left <= right;
  };
  const and = (active: boolean): boolean => {
    let v = comparison(active);
    while (tokens[i] === "&&") {
      i++;
      const next = comparison(active && v);
      v = v && next;
    }
    return v;
  };
  const or = (active: boolean): boolean => {
    let v = and(active);
    while (tokens[i] === "||") {
      i++;
      const next = and(active && !v);
      v = v || next;
    }
    return v;
  };
  const result = or(true);
  if (i !== tokens.length) throw Error("本地表达式引擎不支持此语法");
  return result;
}
