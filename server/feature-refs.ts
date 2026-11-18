/** Legacy expression rules can omit dependency metadata. Ignore literals, comments,
 * function names and object properties before matching actual catalog variables. */
export function expressionFeatureNames(expression: unknown): Set<string> {
  if (typeof expression !== "string") return new Set();
  const code = expression.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    " ",
  );
  const locals = new Set(
    [
      ...code.matchAll(
        /\b(?:let|var|const|def)\s+([$_\p{L}][$_\p{L}\p{N}]*)/gu,
      ),
    ].map((m) => m[1]),
  );
  const names = new Set<string>();
  for (const match of code.matchAll(/[$_\p{L}][$_\p{L}\p{N}]*/gu)) {
    const name = match[0],
      index = match.index!;
    if (
      [
        "true",
        "false",
        "null",
        "undefined",
        "new",
        "return",
        "let",
        "var",
        "const",
        "def",
      ].includes(name) ||
      locals.has(name)
    )
      continue;
    let left = index - 1,
      right = index + name.length;
    while (left >= 0 && /\s/.test(code[left])) left--;
    while (right < code.length && /\s/.test(code[right])) right++;
    if (code[left] === "." || code[right] === "(") continue;
    names.add(name);
  }
  return names;
}

export function featureDependencyNames(
  detail: any,
  dependency?: any,
): Set<string> {
  const names = new Set<string>();
  for (const field of [detail.paramList, detail.param_list]) {
    for (const value of typeof field === "string"
      ? field.split(",")
      : Array.isArray(field)
        ? field
        : []) {
      const name = typeof value === "string" ? value.trim() : value?.name;
      if (name) names.add(name);
    }
  }
  for (const field of [detail.parsedExpInfo, detail.parsed_exp_info]) {
    try {
      const parsed = typeof field === "string" ? JSON.parse(field) : field;
      for (const name of parsed?.dependentEleNames || [])
        if (typeof name === "string") names.add(name);
    } catch {}
  }
  for (const name of expressionFeatureNames(
    detail.originExpression || detail.origin_expression || detail.expression,
  ))
    names.add(name);
  try {
    const input =
      typeof dependency?.inputDependentConfig === "string"
        ? JSON.parse(dependency.inputDependentConfig)
        : dependency?.inputDependentConfig;
    const constants = new Set(
      String(input?.constantFields || "")
        .split(",")
        .map((s: string) => s.trim()),
    );
    for (const [field, value] of Object.entries(input || {}))
      if (
        field !== "constantFields" &&
        !constants.has(field) &&
        typeof value === "string" &&
        value.trim()
      ) {
        names.add(value.trim());
      }
  } catch {}
  return names;
}
