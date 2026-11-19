/** Parse numbered condition logic. No eval or JavaScript execution. */
export function compileConditionLogic(
  logic: string,
  conditions: string[],
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
    if (n < 1 || n > conditions.length)
      throw Error("条件编号 " + n + " 不存在");
    return "(" + conditions[n - 1] + ")";
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
): boolean {
  if (typeof expression !== "string" || !expression.trim())
    throw Error("表达式不能为空");
  const text = expression.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern =
    /\s*(>=|<=|==|!=|&&|\|\||[!()<>]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*)/gy;
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
  const value = (): unknown => {
    const t = tokens[i++];
    if (!t) throw Error("缺少表达式操作数");
    if (t === "(") {
      const v = or();
      if (tokens[i++] !== ")") throw Error("表达式括号不匹配");
      return v;
    }
    if (t === "!") return !Boolean(value());
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (/^"/.test(t)) return JSON.parse(t);
    if (/^'/.test(t)) return t.slice(1, -1).replace(/\\'/g, "'");
    if (/^-?\d/.test(t)) return Number(t);
    if (!/^[A-Za-z_$][\w$]*$/.test(t)) throw Error("缺少表达式操作数");
    if (!(t in input)) throw Error("缺少输入参数：" + t);
    return input[t];
  };
  const comparison = (): boolean => {
    const left = value(),
      op = tokens[i];
    if (![">", ">=", "<", "<=", "==", "!="].includes(op)) return Boolean(left);
    i++;
    const right = value();
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
  const and = (): boolean => {
    let v = comparison();
    while (tokens[i] === "&&") {
      i++;
      const next = comparison();
      v = v && next;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (tokens[i] === "||") {
      i++;
      const next = and();
      v = v || next;
    }
    return v;
  };
  const result = or();
  if (i !== tokens.length) throw Error("本地表达式引擎不支持此语法");
  return result;
}
