import { config } from "../config.js";

export async function healthHandler(req, res) {
  res.json({
    ok: true,
    service: "tagers-kiss-api",
    time_iso: new Date().toISOString(),
    db: config.databaseUrl ? "postgres" : "memory",
  });
}

/**
 * Diagnóstico de LangSmith/LangChain
 * GET /health/langsmith
 */
export async function langsmithHealthHandler(req, res) {
  const status = {
    ok: true,
    service: "langsmith-diagnostic",
    time_iso: new Date().toISOString(),
    config: {
      LANGCHAIN_TRACING_V2: process.env.LANGCHAIN_TRACING_V2 || "not set",
      LANGCHAIN_API_KEY: process.env.LANGCHAIN_API_KEY 
        ? `${process.env.LANGCHAIN_API_KEY.slice(0, 15)}...` 
        : "not set",
      LANGCHAIN_PROJECT: process.env.LANGCHAIN_PROJECT || "not set",
      LANGCHAIN_ENDPOINT: process.env.LANGCHAIN_ENDPOINT || "not set",
    },
    enabled: process.env.LANGCHAIN_TRACING_V2 === "true" && Boolean(process.env.LANGCHAIN_API_KEY),
    dependencies: {},
  };

  // Test langsmith import
  try {
    const { traceable } = await import("langsmith/traceable");
    status.dependencies.langsmith = typeof traceable === "function" ? "✅ OK" : "❌ traceable not a function";
  } catch (e) {
    status.dependencies.langsmith = `❌ ${e.message}`;
    status.ok = false;
  }

  // Test @langchain/langgraph import
  try {
    const { StateGraph } = await import("@langchain/langgraph");
    status.dependencies["@langchain/langgraph"] = StateGraph ? "✅ OK" : "❌ StateGraph undefined";
  } catch (e) {
    status.dependencies["@langchain/langgraph"] = `⚠️ Not installed (optional): ${e.message}`;
  }

  // Test @langchain/core import
  try {
    const { HumanMessage } = await import("@langchain/core/messages");
    status.dependencies["@langchain/core"] = HumanMessage ? "✅ OK" : "❌ HumanMessage undefined";
  } catch (e) {
    status.dependencies["@langchain/core"] = `⚠️ Not installed (optional): ${e.message}`;
  }

  // Test local langchain module
  try {
    const langchainModule = await import("../langchain/index.js");
    status.dependencies["src/langchain"] = langchainModule.isLangSmithEnabled 
      ? `✅ OK (enabled: ${langchainModule.isLangSmithEnabled()})` 
      : "❌ Module loaded but isLangSmithEnabled missing";
  } catch (e) {
    status.dependencies["src/langchain"] = `❌ ${e.message}`;
    status.ok = false;
  }

  res.json(status);
}
