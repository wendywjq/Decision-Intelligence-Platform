import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import com.google.gson.*;
import com.googlecode.aviator.*;
import com.googlecode.aviator.runtime.function.AbstractVariadicFunction;
import com.googlecode.aviator.runtime.type.*;

public class LocalAviator {
  static final Gson JSON = new GsonBuilder().serializeNulls()
      .setObjectToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE).create();

  static class ZeusFunction extends AbstractVariadicFunction {
    private final String name;
    ZeusFunction(String name) { this.name = name; }
    public String getName() { return name; }
    public AviatorObject variadicCall(Map<String,Object> env, AviatorObject... args) {
      Object a = args[0].getValue(env);
      Object b = args.length > 1 ? args[1].getValue(env) : null;
      Object result;
      switch (name) {
        case "isNotEmpty": result = a != null && !a.toString().isEmpty(); break;
        case "array.contains":
          result = a instanceof Collection ? ((Collection<?>) a).contains(b)
              : Arrays.asList(String.valueOf(a).split(",", -1)).contains(String.valueOf(b));
          break;
        case "string.toLowerCase": result = ((String)a).toLowerCase(Locale.ROOT); break;
        case "string.toUpperCase": result = ((String)a).toUpperCase(Locale.ROOT); break;
        case "jsonString.toList": result = JSON.fromJson((String)a, List.class); break;
        case "string.getFromJsonMap":
          result = JSON.fromJson((String)a, Map.class).get(String.valueOf(b)); break;
        default: throw new IllegalArgumentException("未知函数 " + name);
      }
      return AviatorRuntimeJavaType.valueOf(result);
    }
  }

  public static void main(String[] args) {
    Map<String,Object> response = new HashMap<>();
    try {
      JsonObject request = JsonParser.parseReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).getAsJsonObject();
      AviatorEvaluatorInstance engine = AviatorEvaluator.newInstance(EvalMode.INTERPRETER);
      engine.enableSandboxMode();
      engine.disableFeature(Feature.Use);
      engine.disableFeature(Feature.StaticFields);
      engine.disableFeature(Feature.StringInterpolation);
      engine.setOption(Options.MAX_LOOP_COUNT, 10000);
      engine.setOption(Options.EVAL_TIMEOUT_MS, 500L);
      engine.setOption(Options.ENABLE_PROPERTY_SYNTAX_SUGAR, false);
      for (String name : Arrays.asList("print", "println", "p", "pst", "eval", "load", "require", "readline", "sysdate")) engine.removeFunction(name);
      for (String name : Arrays.asList("isNotEmpty", "array.contains", "jsonString.toList", "string.getFromJsonMap", "string.toLowerCase", "string.toUpperCase"))
        engine.addFunction(new ZeusFunction(name));
      Map<String,Object> input = JSON.fromJson(request.get("input"), Map.class);
      Expression expression = engine.compile(request.get("expression").getAsString());
      Object result;
      if (request.has("mapping")) {
        JsonObject mapping = request.getAsJsonObject("mapping");
        Object values = input.get(mapping.get("source").getAsString());
        if (!(values instanceof List) || ((List<?>) values).size() > 250)
          throw new IllegalArgumentException("映射输入须为不超过 250 个元素的列表");
        String param = mapping.get("param").getAsString();
        List<Object> results = new ArrayList<>();
        for (Object value : (List<?>) values) {
          Map<String,Object> env = new HashMap<>(input);
          env.put(param,value);
          results.add(expression.execute(env));
        }
        result = results;
      } else {
        result = expression.execute(input);
      }
      response.put("value", result);
    } catch (Throwable error) {
      response.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
    }
    System.out.print(JSON.toJson(response));
  }
}
