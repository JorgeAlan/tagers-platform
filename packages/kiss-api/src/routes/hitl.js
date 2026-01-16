import express from "express";
import { config } from "../config.js";
import { listBranches } from "../hitl/branch_registry.js";
import { recordHitlResponse } from "../hitl/hitl_service.js";
import { getInstruction } from "../db/repo.js";

export const hitlRouter = express.Router();

hitlRouter.get("/branches", (req, res) => {
  res.json({ ok: true, hitl_enabled: config.hitl.enabled, branches: listBranches() });
});

// Tablet → resolve instruction (HITL)
hitlRouter.post("/respond", async (req, res) => {
  try {
    const { instruction_id, decision, comment = "" } = req.body || {};
    if (!instruction_id || !decision) {
      return res.status(400).json({ ok: false, error: "instruction_id and decision are required" });
    }

    // Optional auth via device token header
    const token = (req.headers["x-device-token"] || "").toString();
    let effectiveBranch = null;
    let instrBranch = null;
    if (token) {
      const allowedBranch = Object.entries(config.hitl?.branchTokens || {}).find(([, t]) => t === token)?.[0];
      if (!allowedBranch) {
        return res.status(401).json({ ok: false, error: "invalid device token" });
      }
      const instr = await getInstruction(instruction_id);
      instrBranch = instr?.target?.location_id || instr?.payload?.target?.location_id || null;
      if (instrBranch && instrBranch !== allowedBranch) {
        return res.status(403).json({ ok: false, error: "token not authorized for this instruction" });
      }

      effectiveBranch = allowedBranch;
    }

    // If no token provided, best-effort derive branch from instruction.
    if (!effectiveBranch) {
      if (!instrBranch) {
        const instr = await getInstruction(instruction_id);
        instrBranch = instr?.target?.location_id || instr?.payload?.target?.location_id || null;
      }
      effectiveBranch = instrBranch;
    }

    const result = await recordHitlResponse({
      instruction_id,
      branch_id: effectiveBranch,
      decision,
      comment,
      actor: {
        role: "STAFF_TABLET",
      },
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});
